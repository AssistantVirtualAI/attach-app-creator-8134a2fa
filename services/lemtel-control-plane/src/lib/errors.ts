export class ConfigError extends Error {
  constructor(public readonly setting: string, reason: string) {
    super(`config_invalid:${setting}:${reason}`);
    this.name = "ConfigError";
  }
}
