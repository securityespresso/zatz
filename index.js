require('dotenv').config();

const Telegraf = require('telegraf');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const TRUST_AGE = 6 * 60 * 60 * 1000; // 6h
const groups = {};

const messages = {
  removed: (user, reason) => {
    const name = user.first_name + (user.username ? ` (@${user.username})` : '');
    return `☝️ Message from ${name} removed. Reason: ${reason}`;
  },
};

const formatChatName = chat => {
  const { id, title, username } = chat;
  const user = username ? ` @${username}` : '';
  return `${title} (${id}${user})`;
};

const formatUserName = member => {
  const { id, first_name: name, username } = member;
  const user = username ? `(@${username})` : '';
  return `${name}[${id}] ${user}`;
};

const to = promise => promise
  .then(r => [r, null])
  .catch(e => [null, e]);

// Mark join times for new users
bot.use(async (ctx, next) => {

  const now = Date.now();
  const chatName = formatChatName(ctx.chat);

  if (typeof groups[ctx.chat.id] === 'undefined') {
    groups[ctx.chat.id] = { users: {}, admins: {}, lastUpdate: 0 };
    console.log(`Chat ${chatName} was added to the group list`);
  }

  const { lastUpdate } = groups[ctx.chat.id];
  const updateInterval = 3600 * 1000; // update one time per hour at most

  if (now - lastUpdate > updateInterval) {

    const [admins, error] = await to(ctx.getChatAdministrators());

    if (error) {
      console.log(`Failed to fetch chat admins: ${error.stack}`);
      return; // give up on message
    }

    groups[ctx.chat.id].admins = admins.reduce((list, { user }) => {
      const { id } = user;
      const name = formatUserName(user);
      return { ...list, [id]: { id, name } };
    }, {});

    groups[ctx.chat.id].lastUpdate = now;
    console.log(`Admin list for ${chatName} was updated`);
  }

  if (!ctx.updateSubTypes.includes('new_chat_members')) {
    return next();
  }

  ctx.message.new_chat_members.forEach(m => {
    if (!groups[ctx.chat.id].users[m.id]) {
      groups[ctx.chat.id].users[m.id] = {
        since: Date.now(),
        username: m.username,
      };
      const user = formatUserName(m);
      console.log(`User ${user} joined ${chatName}. Marking as untrusted!`);
    }
  });
});

// Untrust kicked users
bot.use(async (ctx, next) => {

  if (!ctx.updateSubTypes.includes('left_chat_member')) {
    return next();
  }

  const member = ctx.message.left_chat_member;

  if (ctx.from.id !== member.id) { // user was kicked/banned
    delete groups[ctx.chat.id].users[member.id]; // untrust user
    const fullName = formatUserName(member);
    const chatName = formatChatName(ctx.chat);
    console.log(`User ${fullName} is now untrusted in ${chatName}`);
  }
});

// Check if the user is trusted
bot.use(async (ctx, next) => {

  const { users, admins } = groups[ctx.chat.id];
  const { id: uid } = ctx.from;
  const fullName = formatUserName(ctx.from);
  const chatName = formatChatName(ctx.chat);

  if (typeof admins[uid] !== 'undefined') {
    console.log(`Message from an admin ${fullName} in ${chatName}. Ignoring`);
    return;
  }

  if (typeof users[uid] === 'undefined') {
    console.log(`User ${fullName} join date in ${chatName} is unknown - will consider it trusted`);
    users[uid] = { since: 0 };
  }

  if (Date.now() - users[uid].since >= TRUST_AGE) {
    console.log(`User ${fullName} is trusted`);
    return; // end call chain
  }

  next();
});

// detect url, animation, photo, document, voice, audio, video_note, sticker
bot.use(async (ctx, next) => {
  const message = ctx.message || ctx.editedMessage;
  const blacklist = ['animation', 'photo', 'document', 'voice', 'audio', 'video', 'sticker', 'video_note'];
  const restrictedItems = ctx.updateSubTypes.filter(type => blacklist.includes(type));
  const entities = message.entities || [];
  const hasLinks = entities.reduce((acc, e) => (acc || e.type === 'url'), false);

  if (hasLinks) {
    restrictedItems.push('link');
  }

  if (restrictedItems.length) {
    const reason = restrictedItems.join(', ');
    const msg = messages.removed(ctx.from, 'new user + ' + reason);

    const [, error] = await to(Promise.all([
      ctx.deleteMessage(),
      ctx.reply(msg),
    ]));

    if (!error) {
      console.error(`Action failed: ${error.stack}`);
    }

    console.log(`[failed] ${msg}`);
  }

  return next();
});

bot.startPolling();
console.log('Zatz started');
