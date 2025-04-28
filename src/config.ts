import { logger } from "./logger";
import * as dotenv from "dotenv";
dotenv.config();

export const retrieveEnvVariable = (variableName: string) => {
  const variable = process.env[variableName] || '';
  if (!variable) {
    logger.info(`${variableName} is not set`);
    process.exit(1);
  }
  return variable;
};