import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField
} from "discord.js";

import fs from "fs";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID
};

const productsPath = "./data/products.json";

/* ================= JSON ================= */

function ensureJSON() {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync(productsPath))
    fs.writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2));
}

function getProducts() {
  ensureJSON();
  return JSON.parse(fs.readFileSync(productsPath));
}

function saveProducts(data) {
  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2));
}

function formatar(v) {
  return Number(v || 0).toFixed(2).replace(".", ",");
}

/* ================= DISCORD ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let editorState = {};

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar produto"),

  new SlashCommandBuilder()
    .setName("listar-produtos")
    .setDescription("Listar produtos"),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

/* ================= READY ================= */

client.once("ready", async () => {
  console.log("✅ Loja Premium Online");

  const guild = client.guilds.cache.first();
  if (!guild) return;

  await rest.put(
    Routes.applicationGuildCommands(config.clientId, guild.id),
    { body: commands }
  );

  console.log("✅ Comandos registrados");
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  try {

    if (interaction.isChatInputCommand()) {

      await interaction.deferReply({ ephemeral: true });

      if (!interaction.member.roles.cache.has(config.adminRoleId))
        return interaction.editReply({ content: "❌ Sem permissão." });

      const data = getProducts();

      /* ===== CRIAR PRODUTO SIMPLES ===== */

      if (interaction.commandName === "criar-produto") {

        const produto = {
          id: Date.now().toString(),
          nome: "Novo Produto",
          descricao: "Descrição do produto...",
          preco: 0,
          estoque: 0,
          link: "https://link.com"
        };

        data.products.push(produto);
        saveProducts(data);

        return interaction.editReply({
          embeds: [gerarEmbedPremium(produto)]
        });
      }

      /* ===== LISTAR ===== */

      if (interaction.commandName === "listar-produtos") {

        if (!data.products.length)
          return interaction.editReply({ content: "❌ Nenhum produto." });

        let lista = "**📦 Produtos cadastrados:**\n\n";
        data.products.forEach(p => {
          lista += `ID: \`${p.id}\` • ${p.nome}\n`;
        });

        return interaction.editReply({ content: lista });
      }

      /* ===== PAINEL ===== */

      if (interaction.commandName === "painel") {

        if (!data.products.length)
          return interaction.editReply({ content: "❌ Sem produtos." });

        for (const p of data.products) {

          const embed = gerarEmbedPremium(p);

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_${p.id}`)
              .setLabel("🛒 Comprar")
              .setStyle(ButtonStyle.Success)
          );

          await interaction.channel.send({
            embeds: [embed],
            components: [row]
          });
        }

        return interaction.editReply({ content: "✅ Painel criado!" });
      }
    }

    /* ===== BOTÃO COMPRAR ===== */

    if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

      await interaction.deferReply({ ephemeral: true });

      const id = interaction.customId.replace("buy_", "");
      const produto = getProducts().products.find(p => p.id === id);

      const canal = await interaction.guild.channels.create({
        name: `compra-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      await canal.send(`✅ Ticket criado para **${produto.nome}**.`);
      return interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
    }

  } catch (err) {
    console.error("ERRO:", err);
    if (!interaction.replied)
      interaction.reply({ content: "❌ Erro interno.", ephemeral: true });
  }
});

/* ================= EMBED PREMIUM ================= */

function gerarEmbedPremium(p) {

  return new EmbedBuilder()
    .setTitle(`🛍 ${p.nome.toUpperCase()}`)
    .setDescription(

      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 **DESCRIÇÃO:**\n${p.descricao}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 **VALOR:** R$ ${formatar(p.preco)}\n` +
      `📦 **ESTOQUE:** ${p.estoque}\n\n` +
      `🔗 **LINK:**\n${p.link}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor("#9b00ff")
    .setImage("https://i.imgur.com/8Km9tLL.png")
    .setFooter({
      text: "Awakening Store • Entrega automática • Compra segura"
    })
    .setTimestamp();
}

client.login(config.token);