import * as dotenv from "dotenv";
dotenv.config();

export const retrieveEnvVariable = (variableName: string) => {
    if (!(variableName in process.env)) {
        console.log(`${variableName} is not set`);
        process.exit(1);
    }
    return process.env[variableName]!;
};
