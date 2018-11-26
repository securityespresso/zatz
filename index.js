require('dotenv').config();

const Telegraf = require('telegraf');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)

const TRUST_AGE = 24 * 60 * 60 * 1000; // 24h
const admins = (process.env.ADMINS || '')
  .split(',')
  .map(id => (+id))
  .filter(i => (i !== 0));

const groups = (process.env.GROUPS || '')
  .split(',')
  .reduce((groups, group) => {
      groups[group] = {};
      admins.forEach(admin => { groups[group][admin] = { since: 0 } });
      return groups;
    }, {});

const messages = {
  removed: (user, reason) => {
    const name = user.first_name + (user.username ? ` (${user.username})` : '');
    return `☝️ Message from ${name} removed. Reason: ${reason}`;
  },
  trusted: (user, reason) => {
    const name = user.first_name + (user.username ? ` (${user.username})` : '');
    return `☝️ ${name} is now trusted`;
  },
  untrusted: (user, reason) => {
    const name = user.first_name + (user.username ? ` (${user.username})` : '');
    return `☝️ ${name} is now untrusted`;
  },
}

// Check if group should be moderated
bot.use(async (ctx, next) => {

  if (groups[ctx.chat.id]) {
    return next();
  }

  console.log(`Chat ${ctx.chat.id} (${ctx.chat.username}) is not in groups list`);
});

// debug
bot.use(async (ctx, next) => {
  next();
});

// Mark join times for new users
bot.use(async (ctx, next) => {

  if (!ctx.updateSubTypes.includes('new_chat_members')) {
    return next();
  }

  ctx.message.new_chat_members.forEach(m => {
    if (!groups[ctx.chat.id][m.id]) {
      console.log(ctx.message);
      groups[ctx.chat.id][m.id] = { since: Date.now() }
      console.log(`User ${m.first_name} (@${m.username}) just joined. Marking as untrusted!`);
    }
  });
});

// Untrust kicked users
bot.use(async (ctx, next) => {

  if (!ctx.updateSubTypes.includes('left_chat_member')) {
    return next();
  }

  const member = ctx.message.left_chat_member;

  if (ctx.from.id != member.id) {
    delete groups[ctx.chat.id][member.id]; // untrust user
    console.log(`User ${member.first_name} ${member.username ? '(@' + member.username + ')' : ''} is now untrusted`);
  }
});

// Check if the user is trusted
bot.use(async (ctx, next) => {

  if (admins.includes(ctx.from.id)) {
    console.log(`Message from an admin (@${ctx.from.username}: ${ctx.from.first_name}). Ignoring`);
    return;
  }

  if (!groups[ctx.chat.id][ctx.from.id]) {
    console.log(`User ${ctx.from.first_name} (@${ctx.from.username}) join date unknown! will consider it trusted`);
    groups[ctx.chat.id][ctx.from.id] = { since: 0 }
  }

  if (Date.now() - groups[ctx.chat.id][ctx.from.id].since >= TRUST_AGE) {
    console.log(`User ${ctx.from.first_name} (@${ctx.from.username}) is trusted`);
    return;
  }

  next();
});

// detect url, animation, photo, document, voice, audio, video_note, sticker
bot.use(async (ctx, next) => {
  const message = ctx.message || ctx.editedMessage;
  const blacklist = ['animation', 'photo', 'document', 'voice', 'audio', 'video', 'sticker', 'video_note'];
  const restrictedItems = ctx.updateSubTypes.filter(type => blacklist.includes(type));
  const entities = message.entities || [];
  const hasLinks = entities.reduce((acc, e) => (acc || e.type == 'url'), false);

  if (hasLinks) {
    restrictedItems.push('link');
  }

  if (restrictedItems.length) {
    const reason = restrictedItems.join(', ');
    const msg = messages.removed(ctx.from, 'new user + ' + reason);
    ctx.deleteMessage(message.id);
    ctx.reply(msg);
    console.log(msg);
  }

  return next();
});

/*
// commands
bot.use(async (ctx, next) => {
  const message = ctx.message || ctx.editedMessage;
  const entities = message.entities || [];
  console.log(entities);

  const commands = entities.reduce((acc, e) => {
    if (e.type == 'bot_command' && e.offset === 0) {
      e.command = message.text.substring(0, e.length);
      acc.push(e);
    }
    if (e.type == 'mention') {
      e.mention = message.text.substring(e.offset, e.offset + e.length);
      acc.push(e);
    }
    return acc;
  }, []);

  console.log(commands, ctx.updateType, ctx.updateSubTypes, ctx.message);

  return next();
});
*/

bot.startPolling();
console.log('Zatz started');
