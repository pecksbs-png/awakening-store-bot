import { REST, Routes } from "discord.js";
import fs from "fs";
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));

export default {
  name: "ready",
  once: true,

  async execute(client) {
    console.log(`✅ ${client.user.tag} está online!`);

    const guild = client.guilds.cache.first();
    if (!guild) {
      console.log("⚠️ Nenhuma guild encontrada.");
      return;
    }

    const rest = new REST({ version: "10" }).setToken(config.token);

    const commands = [];

    client.commands.forEach(cmd => {
      commands.push(cmd.data.toJSON());
    });

    try {

      // Limpa comandos globais
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: [] }
      );

      // Limpa comandos da guild
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, guild.id),
        { body: [] }
      );

      // Registra novos comandos
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, guild.id),
        { body: commands }
      );

      console.log(`✅ ${commands.length} comandos registrados em ${guild.name}`);

    } catch (err) {
      console.error("❌ Erro ao registrar comandos:", err);
    }
  }
};