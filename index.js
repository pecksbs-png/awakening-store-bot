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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import fs from "fs";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID
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
    .setDescription("Abrir editor visual de produto"),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel da loja")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

/* ================= READY ================= */

client.once("ready", async () => {
  console.log("✅ Editor Online");

  const guild = client.guilds.cache.first();
  if (!guild) return console.log("⚠️ Nenhuma guild encontrada.");

  await rest.put(
    Routes.applicationGuildCommands(config.clientId, guild.id),
    { body: commands }
  );

  console.log("✅ Comandos registrados corretamente");
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  try {

    /* ===== COMANDO ===== */

    if (interaction.isChatInputCommand()) {

      if (!interaction.member.roles.cache.has(config.adminRoleId))
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

      editorState[interaction.user.id] = {
        nome: "Nome do Produto",
        descricao: "Descrição do produto...",
        preco: 0,
        estoque: 0,
        link: "https://link.com"
      };

      return interaction.reply({
        embeds: [gerarEmbed(interaction.user.id)],
        components: gerarBotoes(),
        ephemeral: true
      });
    }

    /* ===== BOTÕES ===== */

    if (interaction.isButton()) {

      const userId = interaction.user.id;

      if (!editorState[userId])
        return interaction.reply({ content: "❌ Editor expirado.", ephemeral: true });

      if (interaction.customId === "salvar") {

        const data = getProducts();
        data.products.push({
          id: Date.now().toString(),
          ...editorState[userId]
        });

        saveProducts(data);
        delete editorState[userId];

        return interaction.update({
          content: "✅ Produto salvo com sucesso!",
          embeds: [],
          components: []
        });
      }

      if (interaction.customId === "cancelar") {
        delete editorState[userId];
        return interaction.update({
          content: "❌ Produto cancelado.",
          embeds: [],
          components: []
        });
      }

      const campo = interaction.customId.replace("editar_", "");

      const modal = new ModalBuilder()
        .setCustomId(`modal_${campo}`)
        .setTitle("Editar Produto");

      const input = new TextInputBuilder()
        .setCustomId("valor_input")
        .setLabel(`Novo ${campo}`)
        .setStyle(
          campo === "descricao"
            ? TextInputStyle.Paragraph
            : TextInputStyle.Short
        )
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }

    /* ===== MODAL ===== */

    if (interaction.isModalSubmit()) {

      const userId = interaction.user.id;
      const campo = interaction.customId.replace("modal_", "");
      const valor = interaction.fields.getTextInputValue("valor_input");

      if (!editorState[userId])
        return interaction.reply({ content: "❌ Editor expirado.", ephemeral: true });

      editorState[userId][campo] =
        campo === "preco" || campo === "estoque"
          ? Number(valor)
          : valor;

      return interaction.reply({
        embeds: [gerarEmbed(userId)],
        components: gerarBotoes(),
        ephemeral: true
      });
    }

  } catch (err) {
    console.error("ERRO:", err);
    if (!interaction.replied)
      interaction.reply({ content: "❌ Erro interno.", ephemeral: true });
  }

});

/* ================= AUX ================= */

function gerarEmbed(userId) {

  const p = editorState[userId];

  return new EmbedBuilder()
    .setTitle("🛍 PREVIEW DO PRODUTO")
    .setDescription(
      `━━━━━━━━━━━━━━━━━━\n` +
      `📦 Nome: ${p.nome}\n\n` +
      `📝 Descrição:\n${p.descricao}\n\n` +
      `💰 Preço: R$ ${formatar(p.preco)}\n` +
      `📦 Estoque: ${p.estoque}\n` +
      `🔗 Link: ${p.link}\n` +
      `━━━━━━━━━━━━━━━━━━`
    )
    .setColor("#00ff88");
}

function gerarBotoes() {

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("editar_nome").setLabel("✏️ Nome").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("editar_descricao").setLabel("📝 Descrição").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("editar_preco").setLabel("💰 Preço").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("editar_estoque").setLabel("📦 Estoque").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("editar_link").setLabel("🔗 Link").setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("salvar").setLabel("✅ Salvar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cancelar").setLabel("❌ Cancelar").setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

client.login(config.token);