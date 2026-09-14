require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, PermissionsBitField, AttachmentBuilder, MessageFlags } = require('discord.js');
const db = require('./db');
const { generateCardPng } = require('./cardRenderer');
const { buildListResponse } = require('./commands/gList');
const { buildSliderControls } = require('./commands/gCard');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const gAdd = require('./commands/gAdd');
const gStock = require('./commands/gStock');
const gList = require('./commands/gList');
const gCard = require('./commands/gCard');
const gPlus10 = require('./commands/gPlus10');

client.commands.set(gAdd.data.name, gAdd);
client.commands.set(gStock.data.name, gStock);
client.commands.set(gList.data.name, gList);
client.commands.set(gCard.data.name, gCard);
client.commands.set(gPlus10.data.name, gPlus10);

// Register Slash Commands
// Using clientReady event (ready is deprecated in discord.js v14 and renamed in v15)
const readyEvent = Client.prototype.hasOwnProperty('clientReady') || 'clientReady' in client ? 'clientReady' : 'ready';
client.once('clientReady', async () => {
  console.log(`🛡️ Logged in as ${client.user.tag}`);

  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    console.warn('⚠️ DISCORD_TOKEN or CLIENT_ID is missing in .env. Skipping slash command registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commandData = Array.from(client.commands.values()).map(c => c.data.toJSON());

  try {
    if (process.env.GUILD_ID && process.env.GUILD_ID.trim() !== '') {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commandData }
      );
      console.log(`✅ Registered guild slash commands for guild ${process.env.GUILD_ID}.`);
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commandData }
      );
      console.log('✅ Registered global slash commands.');
    }
  } catch (err) {
    console.error('❌ Command registration error:', err);
  }
});

// Interaction Handling
client.on('interactionCreate', async interaction => {
  try {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (error) {
        console.error('Command execution error:', error);
        // Avoid sending reply if interaction has timed out (DiscordAPIError 10062)
        if (error.code === 10062) return;
        const reply = { content: '❌ There was an error executing this command!', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
      }
    }

    // 2. Autocomplete
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (autoErr) {
          console.error('Autocomplete error:', autoErr);
        }
      }
    }

    // 3. Button Interactions
    if (interaction.isButton()) {
      const parts = interaction.customId.split('_');
      const action = parts[0];
      const param1 = parts[1];
      const param2 = parts[2];

      // View Card Ephemeral Button
      if (action === 'card') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const item = db.getGearById(param1);
        if (!item) {
          return interaction.editReply('❌ Item no longer exists in database.');
        }

        try {
          const currentLevel = item.upgrade_level || '+0';
          const isQuantity = /^[xX]\d+$/i.test(currentLevel);
          const imageBuffer = await generateCardPng(item.wiki_url, currentLevel);
          const attachment = new AttachmentBuilder(imageBuffer, { name: `${item.base_item_name.replace(/\s+/g, '_')}_${currentLevel}.png` });

          const levelSuffix = (currentLevel && currentLevel !== '+0') ? ` ${currentLevel}` : '';
          const replyPayload = { 
            content: `🔍 **${item.base_item_name}${levelSuffix}** (Held by: ${item.added_by_username})`,
            files: [attachment]
          };

          // Only add slider controls if it is an upgrade level, not a quantity
          if (!isQuantity) {
            const row = buildSliderControls(item.base_item_name, currentLevel);
            replyPayload.components = [row];
          }

          return interaction.editReply(replyPayload);
        } catch (cardErr) {
          console.error('Failed to generate card image:', cardErr);
          return interaction.editReply(`❌ Failed to render card for **${item.base_item_name}**: ${cardErr.message}`);
        }
      }

      // Remove Item Button (Allowed for submitter or officer)
      if (action === 'remove') {
        const item = db.getGearById(param1);
        if (!item) {
          return interaction.reply({ content: '❌ Item no longer exists in database.', flags: MessageFlags.Ephemeral });
        }

        const isAdder = item.added_by_user_id === interaction.user.id;
        const authorizedRoles = (process.env.AUTHORIZED_ROLE_IDS || '').split(',').map(r => r.trim());
        const hasOfficerRole = interaction.member?.roles?.cache?.some(r => authorizedRoles.includes(r.id));
        const isAdmin = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
        const isOfficer = Boolean(hasOfficerRole || isAdmin);

        // Only display and allow removal for the person who added the item or an officer
        if (!isAdder && !isOfficer) {
          return interaction.reply({ 
            content: '❌ Only the person who added this item or a Guild Officer can remove it from the gear list.', 
            flags: MessageFlags.Ephemeral 
          });
        }

        db.removeGearById(param1);
        const updatedList = buildListResponse(interaction.user.id, isOfficer);
        await interaction.update(updatedList);
        
        await interaction.followUp({
          content: `🗑️ Removed **${item.base_item_name} ${item.upgrade_level}** (ID #${item.id}) from the inventory.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Request / Claim Item Button
      if (action === 'request') {
        const item = db.getGearById(param1);
        if (!item) {
          return interaction.reply({ content: '❌ Item no longer exists in database.', flags: MessageFlags.Ephemeral });
        }

        if (item.requested_by_user_id) {
          return interaction.reply({ 
            content: `⚠️ This item is already claimed by **${item.requested_by_username}**.`, 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (item.added_by_user_id === interaction.user.id) {
          return interaction.reply({ 
            content: '⚠️ You are the holder of this item! You cannot request your own item.', 
            flags: MessageFlags.Ephemeral 
          });
        }

        const username = interaction.member?.displayName || interaction.user.username;
        db.claimGear(param1, interaction.user.id, username);

        const authorizedRoles = (process.env.AUTHORIZED_ROLE_IDS || '').split(',').map(r => r.trim());
        const hasOfficerRole = interaction.member?.roles?.cache?.some(r => authorizedRoles.includes(r.id));
        const isAdmin = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
        const isOfficer = Boolean(hasOfficerRole || isAdmin);

        const updatedList = buildListResponse(interaction.user.id, isOfficer);
        await interaction.update(updatedList);

        await interaction.followUp({
          content: `✋ You have requested **${item.base_item_name} ${item.upgrade_level}** (ID #${item.id})!`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Withdraw Claim Button
      if (action === 'withdraw') {
        const item = db.getGearById(param1);
        if (!item) {
          return interaction.reply({ content: '❌ Item no longer exists in database.', flags: MessageFlags.Ephemeral });
        }

        if (item.requested_by_user_id !== interaction.user.id) {
          return interaction.reply({ 
            content: '❌ You do not have an active request on this item.', 
            flags: MessageFlags.Ephemeral 
          });
        }

        db.withdrawGear(param1, interaction.user.id);

        const authorizedRoles = (process.env.AUTHORIZED_ROLE_IDS || '').split(',').map(r => r.trim());
        const hasOfficerRole = interaction.member?.roles?.cache?.some(r => authorizedRoles.includes(r.id));
        const isAdmin = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
        const isOfficer = Boolean(hasOfficerRole || isAdmin);

        const updatedList = buildListResponse(interaction.user.id, isOfficer);
        await interaction.update(updatedList);

        await interaction.followUp({
          content: `↩ Withdrew your request for **${item.base_item_name} ${item.upgrade_level}** (ID #${item.id}). It is now available for others to claim.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Paging Navigation Button
      if (action === 'gpage') {
        const targetPage = parseInt(param1, 10) || 1;
        const authorizedRoles = (process.env.AUTHORIZED_ROLE_IDS || '').split(',').map(r => r.trim());
        const hasOfficerRole = interaction.member?.roles?.cache?.some(r => authorizedRoles.includes(r.id));
        const isAdmin = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
        const isOfficer = Boolean(hasOfficerRole || isAdmin);

        const updatedList = buildListResponse(interaction.user.id, isOfficer, targetPage);
        await interaction.update(updatedList);
        return;
      }

      // Card Slider Buttons (legacy support)
      if (action === 'slide') {
        await interaction.deferUpdate();
        const baseItemName = decodeURIComponent(param1);
        const targetLevel = param2;
        const formattedTitle = baseItemName.replace(/\s+/g, '_');
        const wikiUrl = `https://eqlwiki.com/${encodeURIComponent(formattedTitle)}`;

        try {
          const imageBuffer = await generateCardPng(wikiUrl, targetLevel);
          const attachment = new AttachmentBuilder(imageBuffer, { name: 'card.png' });
          const row = buildSliderControls(baseItemName, targetLevel);

          await interaction.editReply({ files: [attachment], components: [row] });
        } catch (slideErr) {
          console.error('Slider update error:', slideErr);
        }
      }
    }

    // 4. Select Menu Interactions
    if (interaction.isStringSelectMenu()) {
      // A. Gear List: Item Selection Dropdown
      if (interaction.customId.startsWith('glist_select_item_')) {
        const page = parseInt(interaction.customId.replace('glist_select_item_', ''), 10) || 1;
        const selectedItemId = interaction.values[0];

        const authorizedRoles = (process.env.AUTHORIZED_ROLE_IDS || '').split(',').map(r => r.trim());
        const hasOfficerRole = interaction.member?.roles?.cache?.some(r => authorizedRoles.includes(r.id));
        const isAdmin = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
        const isOfficer = Boolean(hasOfficerRole || isAdmin);

        const updatedList = buildListResponse(interaction.user.id, isOfficer, page, selectedItemId);
        return interaction.update(updatedList);
      }

      // B. Gear List: Action Selection Dropdown
      if (interaction.customId.startsWith('glist_select_action_')) {
        const rawActionValue = interaction.values[0] || '';
        const [actionType, itemId] = rawActionValue.split('_');

        const item = db.getGearById(itemId);
        if (!item) {
          return interaction.reply({ content: '❌ This item no longer exists in the inventory.', flags: MessageFlags.Ephemeral });
        }

        const authorizedRoles = (process.env.AUTHORIZED_ROLE_IDS || '').split(',').map(r => r.trim());
        const hasOfficerRole = interaction.member?.roles?.cache?.some(r => authorizedRoles.includes(r.id));
        const isAdmin = interaction.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator);
        const isOfficer = Boolean(hasOfficerRole || isAdmin);
        const isAdder = item.added_by_user_id === interaction.user.id;

        // Action 1: View Wiki Item Card
        if (actionType === 'view') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          try {
            const currentLevel = item.upgrade_level || '+0';
            const isQuantity = /^[xX]\d+$/i.test(currentLevel);
            const imageBuffer = await generateCardPng(item.wiki_url, currentLevel);
            const attachment = new AttachmentBuilder(imageBuffer, { name: `${item.base_item_name.replace(/\s+/g, '_')}_${currentLevel}.png` });

            const levelSuffix = (currentLevel && currentLevel !== '+0') ? ` ${currentLevel}` : '';
            const replyPayload = { 
              content: `🔍 **${item.base_item_name}${levelSuffix}** (Held by: ${item.added_by_username})`,
              files: [attachment]
            };

            if (!isQuantity) {
              const row = buildSliderControls(item.base_item_name, currentLevel);
              replyPayload.components = [row];
            }

            return interaction.editReply(replyPayload);
          } catch (cardErr) {
            console.error('Failed to render card for selected item:', cardErr);
            return interaction.editReply(`❌ Failed to render card for **${item.base_item_name}**: ${cardErr.message}`);
          }
        }

        // Action 2: Claim Item
        if (actionType === 'claim') {
          if (item.requested_by_user_id) {
            return interaction.reply({ 
              content: `⚠️ This item is already claimed by **${item.requested_by_username}**.`, 
              flags: MessageFlags.Ephemeral 
            });
          }

          if (isAdder) {
            return interaction.reply({ 
              content: '⚠️ You are the donor of this item! You cannot claim your own item.', 
              flags: MessageFlags.Ephemeral 
            });
          }

          const username = interaction.member?.displayName || interaction.user.username;
          db.claimGear(itemId, interaction.user.id, username);

          const parts = interaction.customId.split('_');
          const page = parseInt(parts[3], 10) || 1;
          const updatedList = buildListResponse(interaction.user.id, isOfficer, page, itemId);
          await interaction.update(updatedList);

          return interaction.followUp({
            content: `✋ You have claimed **${item.base_item_name} ${item.upgrade_level}**!`,
            flags: MessageFlags.Ephemeral
          });
        }

        // Action 3: Withdraw Claim
        if (actionType === 'withdraw') {
          if (item.requested_by_user_id !== interaction.user.id) {
            return interaction.reply({ 
              content: '❌ You do not have an active claim on this item.', 
              flags: MessageFlags.Ephemeral 
            });
          }

          db.withdrawGear(itemId, interaction.user.id);

          const parts = interaction.customId.split('_');
          const page = parseInt(parts[3], 10) || 1;
          const updatedList = buildListResponse(interaction.user.id, isOfficer, page, itemId);
          await interaction.update(updatedList);

          return interaction.followUp({
            content: `↩ Withdrew your claim on **${item.base_item_name} ${item.upgrade_level}**. It is now available for others.`,
            flags: MessageFlags.Ephemeral
          });
        }

        // Action 4: Remove Item (Donor or Officer)
        if (actionType === 'remove') {
          if (!isAdder && !isOfficer) {
            return interaction.reply({ 
              content: '❌ Only the donor of this item or a Guild Officer can remove it from the gear list.', 
              flags: MessageFlags.Ephemeral 
            });
          }

          db.removeGearById(itemId);

          const parts = interaction.customId.split('_');
          const page = parseInt(parts[3], 10) || 1;
          const updatedList = buildListResponse(interaction.user.id, isOfficer, page);
          await interaction.update(updatedList);

          return interaction.followUp({
            content: `🗑️ Removed **${item.base_item_name} ${item.upgrade_level}** from the inventory.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }

      // C. Upgrade Level Dropdown (on item card popup)
      if (interaction.customId.startsWith('card_select_level_')) {
        await interaction.deferUpdate();
        const encodedItemName = interaction.customId.replace('card_select_level_', '');
        const baseItemName = decodeURIComponent(encodedItemName);
        const targetLevel = interaction.values[0] || '+0';
        const formattedTitle = baseItemName.replace(/\s+/g, '_');
        const wikiUrl = `https://eqlwiki.com/${encodeURIComponent(formattedTitle)}`;

        try {
          const imageBuffer = await generateCardPng(wikiUrl, targetLevel);
          const attachment = new AttachmentBuilder(imageBuffer, { name: `${baseItemName.replace(/\s+/g, '_')}_${targetLevel}.png` });
          const row = buildSliderControls(baseItemName, targetLevel);

          const levelSuffix = (targetLevel && targetLevel !== '+0') ? ` ${targetLevel}` : '';
          await interaction.editReply({ 
            content: `🔍 **${baseItemName}${levelSuffix}**`,
            files: [attachment], 
            components: [row] 
          });
        } catch (selectErr) {
          console.error('Select menu card update error:', selectErr);
        }
      }
    }
  } catch (err) {
    if (err.code !== 10062) {
      console.error('Interaction error:', err);
    }
  }
});

// Start bot if token is supplied
if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your_discord_bot_token_here') {
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Failed to login to Discord:', err.message);
  });
} else {
  console.log('ℹ️ Bot token not set. To run the bot, provide DISCORD_TOKEN in .env or via environment variables.');
}

module.exports = client;