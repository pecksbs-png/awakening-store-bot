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
  StringSelectMenuBuilder,
  PermissionsBitField
} from "discord.js";

import fs from "fs";
import { MercadoPagoConfig, Payment } from "mercadopago";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mpToken: process.env.MP_TOKEN,
  adminRoleId: process.env.ADMIN_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID
};

const productsPath = "./data/products.json";

/* ================= JSON ================= */

function garantirJSON() {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync(productsPath))
    fs.writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2));
}

function getProducts() {
  garantirJSON();
  return JSON.parse(fs.readFileSync(productsPath));
}

function saveProducts(data) {
  garantirJSON();
  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2));
}

function formatar(v) {
  return v.toFixed(2).replace(".", ",");
}

/* ================= MERCADO PAGO ================= */

const mpClient = new MercadoPagoConfig({
  accessToken: config.mpToken
});
const paymentClient = new Payment(mpClient);

/* ================= DISCORD ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let carrinhos = {};

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar produto")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
    .addStringOption(o => o.setName("descricao").setDescription("Descrição").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço").setRequired(true))
    .addIntegerOption(o => o.setName("estoque").setDescription("Estoque").setRequired(true))
    .addStringOption(o => o.setName("link").setDescription("Link").setRequired(true)),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ Online");
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  try {

    /* ===== CRIAR PRODUTO ===== */

    if (interaction.isChatInputCommand()) {

      await interaction.deferReply({ ephemeral: true });

      if (interaction.commandName === "criar-produto") {

        if (!interaction.member.roles.cache.has(config.adminRoleId))
          return interaction.editReply({ content: "❌ Sem permissão." });

        const data = getProducts();

        const produto = {
          id: Date.now().toString(),
          nome: interaction.options.getString("nome"),
          descricao: interaction.options.getString("descricao"),
          preco: interaction.options.getNumber("preco"),
          estoque: interaction.options.getInteger("estoque"),
          link: interaction.options.getString("link")
        };

        data.products.push(produto);
        saveProducts(data);

        return interaction.editReply({ content: "✅ Produto criado!" });
      }

      /* ===== PAINEL ===== */

      if (interaction.commandName === "painel") {

        const data = getProducts();
        if (data.products.length === 0)
          return interaction.editReply({ content: "❌ Sem produtos." });

        for (const p of data.products) {

          const embed = new EmbedBuilder()
            .setTitle(`🛍 ${p.nome}`)
            .setDescription(
              `${p.descricao}\n\n💰 Valor: R$ ${formatar(p.preco)}\n📦 Estoque: ${p.estoque}`
            )
            .setColor("#00ff88");

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_${p.id}`)
              .setLabel("🛒 Comprar")
              .setStyle(ButtonStyle.Success)
          );

          await interaction.channel.send({ embeds: [embed], components: [row] });
        }

        return interaction.editReply({ content: "✅ Painel criado!" });
      }
    }

    /* ===== BOTÃO BUY ===== */

    if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

      await interaction.deferReply({ ephemeral: true });

      const productId = interaction.customId.replace("buy_", "");
      const data = getProducts();
      const produto = data.products.find(p => p.id === productId);

      if (!produto)
        return interaction.editReply({ content: "❌ Produto não encontrado." });

      const canal = await interaction.guild.channels.create({
        name: `compra-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId || null,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: config.adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });

      carrinhos[canal.id] = {
        produtoId: produto.id,
        quantidade: 1
      };

      const embed = new EmbedBuilder()
        .setTitle("🛍 Confirme sua compra")
        .setDescription(`Produto: **${produto.nome}**\nPreço: R$ ${formatar(produto.preco)}`)
        .setColor("#00ff88");

      const menu = new StringSelectMenuBuilder()
        .setCustomId("quantidade")
        .setPlaceholder("Selecionar quantidade")
        .addOptions(
          Array.from({ length: Math.min(produto.estoque, 10) }, (_, i) => ({
            label: `${i + 1}`,
            value: `${i + 1}`
          }))
        );

      const confirmBtn = new ButtonBuilder()
        .setCustomId("confirmar")
        .setLabel("✅ Confirmar Compra")
        .setStyle(ButtonStyle.Primary);

      await canal.send({
        content: `<@${interaction.user.id}>`,
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(menu),
          new ActionRowBuilder().addComponents(confirmBtn)
        ]
      });

      return interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
    }

    /* ===== CONFIRMAR ===== */

    if (interaction.isButton() && interaction.customId === "confirmar") {

      await interaction.deferReply();

      const carrinho = carrinhos[interaction.channel.id];
      if (!carrinho)
        return interaction.editReply({ content: "❌ Carrinho não encontrado." });

      const data = getProducts();
      const produto = data.products.find(p => p.id === carrinho.produtoId);

      const total = produto.preco * carrinho.quantidade;

      const pagamento = await paymentClient.create({
        body: {
          transaction_amount: total,
          description: produto.nome,
          payment_method_id: "pix",
          payer: { email: "cliente@email.com" }
        }
      });

      return interaction.editReply({
        content:
          `💳 PAGAMENTO GERADO\n\n` +
          `Valor: R$ ${formatar(total)}\n\n` +
          `Copie o código abaixo:\n\n` +
          `${pagamento.point_of_interaction.transaction_data.qr_code}`
      });
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied)
      interaction.reply({ content: "❌ Erro interno.", ephemeral: true });
  }

});

client.login(config.token);