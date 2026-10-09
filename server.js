const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// تخزين الغرف المفتوحة في الذاكرة
const rooms = new Map();

// المراحل وترتيبها الزمني مع المدد الافتراضية
const STAGES = {
  LOBBY: 'LOBBY',
  ROLE_REVEAL: 'ROLE_REVEAL', // 7 sec
  NIGHT: 'NIGHT',             // 30 sec
  INVESTIGATION: 'INVESTIGATION', // 15 sec
  MORNING_ANNOUNCE: 'MORNING_ANNOUNCE', // 6 sec
  DISCUSSION: 'DISCUSSION',   // 90 sec
  VOTING: 'VOTING',           // 30 sec
  VOTE_RESULT: 'VOTE_RESULT', // 6 sec
  GAME_OVER: 'GAME_OVER'
};

function createRoom(roomId, hostSocketId) {
  return {
    id: roomId,
    host: hostSocketId,
    players: new Map(), // socketId -> player object
    settings: {
      mafiaCount: 1,
      doctorCount: 1,
      detectiveCount: 1,
      durations: {
        [STAGES.ROLE_REVEAL]: 7,
        [STAGES.NIGHT]: 30,
        [STAGES.INVESTIGATION]: 15,
        [STAGES.MORNING_ANNOUNCE]: 6,
        [STAGES.DISCUSSION]: 90,
        [STAGES.VOTING]: 30,
        [STAGES.VOTE_RESULT]: 6
      }
    },
    stage: STAGES.LOBBY,
    timer: null,
    timeRemaining: 0,
    nightActions: {
      mafiaVotes: {}, // targetSocketId -> count
      doctorProtect: null
    },
    investigationAction: {
      target: null,
      done: false
    },
    dayVotes: {}, // voterSocketId -> targetSocketId
    eliminatedLastNight: []
  };
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  // إنشاء غرفة
  socket.on('createRoom', ({ username }) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = createRoom(roomId, socket.id);
    rooms.set(roomId, room);

    socket.join(roomId);
    currentRoomId = roomId;

    room.players.set(socket.id, {
      id: socket.id,
      name: username,
      role: null,
      isAlive: true,
      avatar: '/assets/images/players/default.png'
    });

    socket.emit('roomCreated', { roomId, state: getPublicRoomState(room, socket.id) });
  });

  // الانضمام لغرفة
  socket.on('joinRoom', ({ roomId, username }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('errorMsg', 'الغرفة غير موجودة');
    if (room.stage !== STAGES.LOBBY) return socket.emit('errorMsg', 'المباراة بدأت بالفعل');

    socket.join(roomId);
    currentRoomId = roomId;

    room.players.set(socket.id, {
      id: socket.id,
      name: username,
      role: null,
      isAlive: true,
      avatar: '/assets/images/players/default.png'
    });

    broadcastRoomUpdate(roomId);
  });

  // تحديث الإعدادات بواسطة المضيف فقط
  socket.on('updateSettings', (newSettings) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.host !== socket.id || room.stage !== STAGES.LOBBY) return;

    if (newSettings.mafiaCount !== undefined) room.settings.mafiaCount = parseInt(newSettings.mafiaCount);
    if (newSettings.doctorCount !== undefined) room.settings.doctorCount = parseInt(newSettings.doctorCount);
    if (newSettings.detectiveCount !== undefined) room.settings.detectiveCount = parseInt(newSettings.detectiveCount);

    broadcastRoomUpdate(currentRoomId);
  });

  // بدء اللعبة مع التحقق الصارم من إعدادات المضيف
  socket.on('startGame', () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.host !== socket.id || room.stage !== STAGES.LOBBY) return;

    const totalPlayers = room.players.size;
    const { mafiaCount, doctorCount, detectiveCount } = room.settings;
    const specialRolesCount = mafiaCount + doctorCount + detectiveCount;

    // 1. التحقق من الإعدادات الصارمة
    if (isNaN(mafiaCount) || mafiaCount <= 0) {
      return socket.emit('errorMsg', 'يجب أن يكون عدد المافيا عددًا صحيحًا أكبر من صفر.');
    }
    if (mafiaCount >= totalPlayers) {
      return socket.emit('errorMsg', 'يجب أن يكون عدد المافيا أقل من إجمالي عدد اللاعبين لتواجد فريق آخر.');
    }
    if (specialRolesCount > totalPlayers) {
      return socket.emit('errorMsg', `مجموع الأدوار (${specialRolesCount}) يتجاوز عدد اللاعبين الحليين (${totalPlayers}). عدّل التشكيلة.`);
    }

    // توزيع الأدوار
    const playerArray = Array.from(room.players.values());
    const rolesList = [];

    for (let i = 0; i < mafiaCount; i++) rolesList.push('MAFIA');
    for (let i = 0; i < doctorCount; i++) rolesList.push('DOCTOR');
    for (let i = 0; i < detectiveCount; i++) rolesList.push('DETECTIVE');
    while (rolesList.length < totalPlayers) rolesList.push('CITIZEN');

    // خلط الأدوار عشوائيًا (Fisher-Yates)
    for (let i = rolesList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolesList[i], rolesList[j]] = [rolesList[j], rolesList[i]];
    }

    let idx = 0;
    room.players.forEach((p) => {
      p.role = rolesList[idx++];
      p.isAlive = true;
    });

    transitionToStage(room, STAGES.ROLE_REVEAL);
  });

  // الشات والرسائل اللحظية مع الصلاحيات الخادمة
  socket.on('sendMessage', ({ text, channel }) => {
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    if (!text || text.trim().length === 0 || text.length > 250) return;

    // منع الموتى من التحدث للشات الرئيسي
    if (!player.isAlive && channel !== 'DEAD') {
      return socket.emit('errorMsg', 'لا يمكن للموتى التحدث في الشات الرئيسي.');
    }

    // قناة المافيا السرية
    if (channel === 'MAFIA') {
      if (player.role !== 'MAFIA' || !player.isAlive) return;
      
      // إرسال لجميع أعضاء المافيا الأحياء فقط
      room.players.forEach((p, sId) => {
        if (p.role === 'MAFIA' && p.isAlive) {
          io.to(sId).emit('newMessage', {
            sender: player.name,
            senderId: socket.id,
            avatar: player.avatar,
            text: text.trim(),
            channel: 'MAFIA',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
      return;
    }

    // قناة الموتى
    if (channel === 'DEAD') {
      if (player.isAlive) return;
      room.players.forEach((p, sId) => {
        if (!p.isAlive) {
          io.to(sId).emit('newMessage', {
            sender: player.name,
            senderId: socket.id,
            avatar: player.avatar,
            text: text.trim(),
            channel: 'DEAD',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
      return;
    }

    // الشات العام
    if (room.stage === STAGES.NIGHT && player.isAlive) {
      return socket.emit('errorMsg', 'الشات مغلق خلال الليل للأفعال السرية.');
    }

    io.to(room.id).emit('newMessage', {
      sender: player.name,
      senderId: socket.id,
      avatar: player.avatar,
      text: text.trim(),
      channel: 'PUBLIC',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // أفعال الليل (مافيا + طبيب)
  socket.on('nightAction', ({ targetId }) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.stage !== STAGES.NIGHT) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isAlive) return;

    const target = room.players.get(targetId);
    if (!target || !target.isAlive) return;

    if (player.role === 'MAFIA') {
      room.nightActions.mafiaVotes[socket.id] = targetId;
    } else if (player.role === 'DOCTOR') {
      room.nightActions.doctorProtect = targetId;
    }
  });

  // أفعال مرحلة التحقيق (المحقق فقط)
  socket.on('investigateAction', ({ targetId }) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.stage !== STAGES.INVESTIGATION) return;
    const player = room.players.get(socket.id);

    // الصلاحيات الصارمة
    if (!player || !player.isAlive || player.role !== 'DETECTIVE') {
      return socket.emit('errorMsg', 'غير مصرح لك بإجراء التحقيق.');
    }
    if (room.investigationAction.done) {
      return socket.emit('errorMsg', 'تم إجراء التحقيق بالفعل لهذه الجولة.');
    }

    const target = room.players.get(targetId);
    if (!target || !target.isAlive) {
      return socket.emit('errorMsg', 'هدف غير صالحة للتحقيق.');
    }

    room.investigationAction.done = true;
    room.investigationAction.target = targetId;

    const isMafia = target.role === 'MAFIA';
    // إرسال النتيجة للمحقق حصراً على الخاص
    socket.emit('investigationResult', {
      targetName: target.name,
      isMafia: isMafia,
      resultText: isMafia ? 'من المافيا' : 'ليس من المافيا'
    });
  });

  // التصويت النهاري
  socket.on('castVote', ({ targetId }) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.stage !== STAGES.VOTING) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isAlive) return;

    const target = room.players.get(targetId);
    if (!target || !target.isAlive) return;

    room.dayVotes[socket.id] = targetId;
    io.to(room.id).emit('voteUpdated', { voterId: socket.id, targetId: targetId });
  });

  // الانفصال
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.players.delete(socket.id);
      if (room.players.size === 0) {
        clearInterval(room.timer);
        rooms.delete(currentRoomId);
      } else {
        if (room.host === socket.id) {
          room.host = Array.from(room.players.keys())[0];
        }
        broadcastRoomUpdate(currentRoomId);
      }
    }
  });
});

// إدارة دورة الحالات والمؤقتات
function transitionToStage(room, newStage) {
  room.stage = newStage;
  if (room.timer) clearInterval(room.timer);

  room.timeRemaining = room.settings.durations[newStage] || 0;

  // أفعال التجهيز قبل دخول المرحلة
  if (newStage === STAGES.NIGHT) {
    room.nightActions = { mafiaVotes: {}, doctorProtect: null };
    sendSystemMessage(room.id, 'حلّ الليل! خذوا حذركم وأغلق الشات العام.');
  } else if (newStage === STAGES.INVESTIGATION) {
    room.investigationAction = { target: null, done: false };
    // معالجة القتل والحماية المسائية فوراً قبل التحقيق
    processNightResults(room);
    sendSystemMessage(room.id, 'بدأت مرحلة التحقيق المستقلة.');
  } else if (newStage === STAGES.MORNING_ANNOUNCE) {
    sendSystemMessage(room.id, 'حلّ الصباح وتمت معالجة أحداث الليل.');
    if (room.eliminatedLastNight.length > 0) {
      const names = room.eliminatedLastNight.map(p => p.name).join(', ');
      sendSystemMessage(room.id, `للأسف، تم إقصاء: ${names}`);
    } else {
      sendSystemMessage(room.id, 'مرت الليلة بسلام ولم يمت أحد!');
    }
  } else if (newStage === STAGES.DISCUSSION) {
    sendSystemMessage(room.id, 'بدأت مرحلة النقاش. يمكن للأحياء التحدث الآن.');
  } else if (newStage === STAGES.VOTING) {
    room.dayVotes = {};
    sendSystemMessage(room.id, 'بدأ التصويت! اختاروا من تشكون به.');
  } else if (newStage === STAGES.VOTE_RESULT) {
    processDayVoting(room);
  }

  broadcastRoomUpdate(room.id);

  // إطلاق المؤقت
  if (room.timeRemaining > 0) {
    room.timer = setInterval(() => {
      room.timeRemaining--;
      io.to(room.id).emit('timerTick', { timeRemaining: room.timeRemaining });

      if (room.timeRemaining <= 0) {
        clearInterval(room.timer);
        advanceGameStage(room);
      }
    }, 1000);
  }
}

function advanceGameStage(room) {
  if (checkWinConditions(room)) return;

  switch (room.stage) {
    case STAGES.ROLE_REVEAL:
      transitionToStage(room, STAGES.NIGHT);
      break;
    case STAGES.NIGHT:
      transitionToStage(room, STAGES.INVESTIGATION);
      break;
    case STAGES.INVESTIGATION:
      transitionToStage(room, STAGES.MORNING_ANNOUNCE);
      break;
    case STAGES.MORNING_ANNOUNCE:
      transitionToStage(room, STAGES.DISCUSSION);
      break;
    case STAGES.DISCUSSION:
      transitionToStage(room, STAGES.VOTING);
      break;
    case STAGES.VOTING:
      transitionToStage(room, STAGES.VOTE_RESULT);
      break;
    case STAGES.VOTE_RESULT:
      if (!checkWinConditions(room)) {
        transitionToStage(room, STAGES.NIGHT);
      }
      break;
  }
}

function processNightResults(room) {
  // تجميع أصوات المافيا
  const votes = room.nightActions.mafiaVotes;
  const targetCounts = {};
  Object.values(votes).forEach(tId => {
    targetCounts[tId] = (targetCounts[tId] || 0) + 1;
  });

  let mafiaTarget = null;
  let maxVotes = 0;
  for (const [tId, count] of Object.entries(targetCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      mafiaTarget = tId;
    }
  }

  room.eliminatedLastNight = [];

  // تطبيق الحماية والقتل
  if (mafiaTarget && mafiaTarget !== room.nightActions.doctorProtect) {
    const victim = room.players.get(mafiaTarget);
    if (victim && victim.isAlive) {
      victim.isAlive = false;
      room.eliminatedLastNight.push(victim);
    }
  }
}

function processDayVoting(room) {
  const counts = {};
  Object.values(room.dayVotes).forEach(tId => {
    counts[tId] = (counts[tId] || 0) + 1;
  });

  let topTarget = null;
  let maxVotes = 0;
  let tie = false;

  for (const [tId, count] of Object.entries(counts)) {
    if (count > maxVotes) {
      maxVotes = count;
      topTarget = tId;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  }

  if (topTarget && !tie) {
    const eliminated = room.players.get(topTarget);
    if (eliminated) {
      eliminated.isAlive = false;
      sendSystemMessage(room.id, `بناءً على تصويت الأغلبية، تم إقصاء اللاعب: ${eliminated.name}`);
    }
  } else {
    sendSystemMessage(room.id, 'انتهى التصويت بالتعادل أو عدم الاقتراع! لم يُطرد أحد.');
  }
}

function checkWinConditions(room) {
  let aliveMafia = 0;
  let aliveInnocents = 0;

  room.players.forEach(p => {
    if (p.isAlive) {
      if (p.role === 'MAFIA') aliveMafia++;
      else aliveInnocents++;
    }
  });

  if (aliveMafia === 0) {
    room.stage = STAGES.GAME_OVER;
    sendSystemMessage(room.id, '🎉 انتصرت أهالي المدينة وشهرت بالمافيا!');
    broadcastRoomUpdate(room.id);
    return true;
  }

  if (aliveMafia >= aliveInnocents) {
    room.stage = STAGES.GAME_OVER;
    sendSystemMessage(room.id, '🔴 سيطرت المافيا على المدينة! فوز المافيا!');
    broadcastRoomUpdate(room.id);
    return true;
  }

  return false;
}

function sendSystemMessage(roomId, text) {
  io.to(roomId).emit('newMessage', {
    sender: 'النظام',
    text: text,
    channel: 'SYSTEM',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
}

function getPublicRoomState(room, socketId) {
  const currentPlayer = room.players.get(socketId);
  const playerList = [];

  room.players.forEach((p) => {
    playerList.push({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive,
      avatar: p.avatar,
      // لا نرسل دور اللاعبين الآخرين أبداً
      role: (p.id === socketId || room.stage === STAGES.GAME_OVER) ? p.role : null
    });
  });

  return {
    roomId: room.id,
    isHost: room.host === socketId,
    stage: room.stage,
    settings: room.settings,
    timeRemaining: room.timeRemaining,
    players: playerList,
    myRole: currentPlayer ? currentPlayer.role : null,
    myIsAlive: currentPlayer ? currentPlayer.isAlive : false
  };
}

function broadcastRoomUpdate(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.players.forEach((p, socketId) => {
    io.to(socketId).emit('roomStateUpdate', getPublicRoomState(room, socketId));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mafia Server running on port ${PORT}`));