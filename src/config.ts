import * as dotenv from "dotenv";
dotenv.config();

export const retrieveEnvVariable = (variableName: string) => {
    const variable = process.env[variableName] || '';
    if (!variable) {
      console.error(`${variableName} is not set`);
      process.exit(1);
    }
    return variable;
  };