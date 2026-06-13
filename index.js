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
  AttachmentBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField
} from "discord.js";

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { MercadoPagoConfig, Payment } from "mercadopago";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mpToken: process.env.MP_TOKEN,
  logChannelId: process.env.LOG_CHANNEL_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID
};

const productsFile = "./data/products.json";

const mpClient = new MercadoPagoConfig({
  accessToken: config.mpToken
});
const paymentClient = new Payment(mpClient);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let carrinhos = {};
let pagamentos = {};

/* ================= FUNÇÕES ================= */

function garantirArquivo() {
  if (!fs.existsSync("./data")) {
    fs.mkdirSync("./data");
  }

  if (!fs.existsSync(productsFile)) {
    fs.writeFileSync(productsFile, JSON.stringify({ products: [] }, null, 2));
  }
}

function getProducts() {
  garantirArquivo();
  return JSON.parse(fs.readFileSync(productsFile));
}

function saveProducts(data) {
  garantirArquivo();
  fs.writeFileSync(productsFile, JSON.stringify(data, null, 2));
}

function formatarValor(valor) {
  return valor.toFixed(2).replace(".", ",");
}

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar produto profissional")
    .addStringOption(o =>
      o.setName("nome").setDescription("Nome do produto").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("descricao").setDescription("Descrição completa").setRequired(true)
    )
    .addNumberOption(o =>
      o.setName("preco").setDescription("Preço").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("estoque").setDescription("Estoque").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("link").setDescription("Link do produto").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel profissional da loja")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ Awakening Store Online");

  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  /* ========= COMANDO CRIAR PRODUTO ========= */

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "criar-produto") {

      if (!interaction.member.roles.cache.has(config.adminRoleId))
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

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

      return interaction.reply({ content: "✅ Produto criado!", ephemeral: true });
    }

    /* ========= PAINEL ========= */

    if (interaction.commandName === "painel") {

      const data = getProducts();

      if (data.products.length === 0)
        return interaction.reply({ content: "❌ Sem produtos.", ephemeral: true });

      for (const p of data.products) {

        const embed = new EmbedBuilder()
          .setTitle(`🛍 ${p.nome}`)
          .setDescription(
            `${p.descricao}\n\n━━━━━━━━━━━━━━━━━━\n` +
            `💰 **Valor:** R$ ${formatarValor(p.preco)}\n` +
            `📦 **Estoque:** ${p.estoque}\n` +
            `━━━━━━━━━━━━━━━━━━`
          )
          .setColor("#00ff88")
          .setFooter({ text: "Awakening Store • Entrega automática" });

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

      return interaction.reply({ content: "✅ Painel criado!", ephemeral: true });
    }
  }

  /* ========= BOTÃO COMPRAR ========= */

  if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

    await interaction.deferReply({ ephemeral: true });

    const productId = interaction.customId.replace("buy_", "");
    const data = getProducts();
    const produto = data.products.find(p => p.id === productId);

    if (!produto)
      return interaction.editReply({ content: "❌ Produto não encontrado." });

    let canal;

    try {
      canal = await interaction.guild.channels.create({
        name: `compra-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId || null,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          },
          {
            id: config.adminRoleId,
            allow: [PermissionsBitField.Flags.ViewChannel]
          }
        ]
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({
        content: "❌ Erro ao criar ticket. Verifique permissões do bot ou categoria."
      });
    }

    carrinhos[canal.id] = {
      userId: interaction.user.id,
      produtoId: produto.id,
      quantidade: 1
    };

    const embed = new EmbedBuilder()
      .setTitle("🛍 Confirme sua Compra")
      .setDescription(
        `📦 Produto: **${produto.nome}**\n\n` +
        `💰 Preço unitário: R$${formatarValor(produto.preco)}\n` +
        `📦 Estoque disponível: ${produto.estoque}\n\n` +
        `Selecione a quantidade abaixo.`
      )
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

    await interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
  }

  /* ========= ALTERAR QUANTIDADE ========= */

  if (interaction.isStringSelectMenu() && interaction.customId === "quantidade") {

    const carrinho = carrinhos[interaction.channel.id];
    const data = getProducts();
    const produto = data.products.find(p => p.id === carrinho.produtoId);

    carrinho.quantidade = parseInt(interaction.values[0]);

    const total = produto.preco * carrinho.quantidade;

    const embed = new EmbedBuilder()
      .setTitle("🛍 Confirme sua Compra")
      .setDescription(
        `📦 Produto: **${produto.nome}**\n\n` +
        `📦 Quantidade: ${carrinho.quantidade}\n` +
        `💰 Total: R$${formatarValor(total)}`
      )
      .setColor("#00ff88");

    await interaction.update({ embeds: [embed] });
  }

});