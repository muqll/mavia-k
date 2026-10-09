// ربط عناصر الواجهة
const authScreen = document.getElementById('auth-screen');
const gameScreen = document.getElementById('game-screen');
const usernameInput = document.getElementById('username-input');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const roomIdInput = document.getElementById('room-id-input');

const displayRoomId = document.getElementById('display-room-id');
const hostControls = document.getElementById('host-controls');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const playersRing = document.getElementById('players-ring');

let currentUser = "";
let currentRoom = "";

// زر إنشاء غرفة
createBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  if (!name) {
    alert('برجاء إدخال اسمك أولاً');
    return;
  }
  currentUser = name;
  currentRoom = Math.random().toString(36).substring(2, 8).toUpperCase();
  enterRoom(true);
});

// زر الانضمام لغرفة
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  const room = roomIdInput.value.trim();
  if (!name || !room) {
    alert('برجاء إدخال الاسم ورمز الغرفة');
    return;
  }
  currentUser = name;
  currentRoom = room.toUpperCase();
  enterRoom(false);
});

// الانتقال لصفحة اللعبة
function enterRoom(isHost) {
  authScreen.classList.remove('active');
  gameScreen.classList.add('active');
  displayRoomId.innerText = currentRoom;

  if (isHost) {
    hostControls.classList.remove('hidden');
  }

  // إضافة رسالة ترحيبية
  appendSystemMessage(`مرحباً بك يا ${currentUser} في الغرفة [${currentRoom}]`);

  // رسم اللاعب على الطاولة
  renderPlayers([
    { name: currentUser, avatar: 'assets/images/players/default.png' }
  ]);
}

// إرسال رسائل الشات
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    appendUserMessage(currentUser, text);
    chatInput.value = '';
  }
});

function appendUserMessage(sender, text) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<strong>${sender}:</strong> ${escapeHtml(text)}`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendSystemMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg system';
  msg.innerHTML = `<strong>النظام:</strong> ${escapeHtml(text)}`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderPlayers(players) {
  playersRing.innerHTML = '';
  players.forEach((p, index) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    seat.style.left = '50%';
    seat.style.top = '50%';

    const img = document.createElement('img');
    img.className = 'player-avatar';
    img.src = p.avatar;
    img.onerror = () => {
      img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='50' height='50'><rect width='50' height='50' fill='%23444'/><text x='50%' y='50%' fill='%23fff' dominant-baseline='middle' text-anchor='middle'>لاعب</text></svg>";
    };

    const name = document.createElement('div');
    name.className = 'player-name';
    name.innerText = p.name;

    seat.appendChild(img);
    seat.appendChild(name);
    playersRing.appendChild(seat);
  });
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}