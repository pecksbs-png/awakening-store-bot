import { REST, Routes } from "discord.js";
import config from "../config.json" assert { type: "json" };

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