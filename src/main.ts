import express from "express";
import dotenv from "dotenv";
import { ethers } from "ethers";
import winston from "winston";
import { SignatureChecker, SignatureCheckerResult } from "./SignatureChecker";
import { BalanceChecker } from "./BalanceChecker";
import { GroupChecker } from "./GroupChecker";
import { abi as validatorGroupImplAbi } from "./abis/ValidatorGroupImpl.json";
import { abi as accountImplAbi } from "./abis/AccountImpl.json";
import { abi as electionImplAbi } from "./abis/ElectionImpl.json";
import { Pool } from "pg";
import { DatabaseService } from "./Database";

dotenv.config();

const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: parseInt(process.env.PG_PORT || "5432", 10),
  ssl: false,
});

const dbService = new DatabaseService(pool);

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: {},
  transports: [new winston.transports.Console()],
});

const app = express();

const rpcUrl = process.env.RPC_URL ?? "https://forno.celo.org";
const signerAddresses = process.env.SIGNER_ADDRESSES?.split(",") || [];

async function main() {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const validatorProxy = new ethers.Contract(
    "0xaEb865bCa93DdC8F47b8e29F40C5399cE34d0C58", // proxy
    validatorGroupImplAbi,
    provider
  );

  const accountProxy = new ethers.Contract(
    "0x7d21685C17607338b313a7174bAb6620baD0aaB7", // proxy
    accountImplAbi,
    provider
  );

  const electionProxy = new ethers.Contract(
    "0x8D6677192144292870907E3Fa8A5527fE55A7ff6", // proxy
    electionImplAbi,
    provider
  );

  const signatureChecker = new SignatureChecker(
    rpcUrl,
    signerAddresses,
    logger,
    dbService
  );

  const balanceChecker = new BalanceChecker(rpcUrl, logger);
  const groupChecker = new GroupChecker(
    rpcUrl,
    validatorProxy,
    accountProxy,
    electionProxy,
    logger,
    dbService
  );

  let unsignedValidators: SignatureCheckerResult;

  try {
    function loop() {
      provider
        .getBlockNumber()
        .then(async (blockNumber) => {
          // signature
          unsignedValidators = await signatureChecker.run(blockNumber);
        })
        .catch((error) => {
          logger.error("Error getting block number:", error);
        })
        .finally(() => {
          setTimeout(loop, 3000);
        });
    }

    loop();
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }

  app.get("/monitored-health", (req, res) => {
    const response =
      unsignedValidators.unsignedValidatorsMonitored.length > 0
        ? "not ok\n" + unsignedValidators.unsignedValidatorsMonitored
        : "ok";
    res.send(`${response}`);
  });

  app.get("/unsigned-all", (req, res) => {
    const response =
      unsignedValidators.unsignedValidatorsAll.length > 0
        ? unsignedValidators.unsignedValidatorsAll
        : "No unsigned validators on this block";
    res.send(`${response}`);
  });

  app.get("/total-balances", async (req, res) => {
    const addresses = req.query.addresses as string | undefined;
    if (!addresses) {
      return res.status(400).send("Addresses query parameter is required");
    }

    const addressArray = addresses.split(",");
    const invalidAddress = addressArray.find(
      (address: string) => !ethers.isAddress(address)
    );
    if (invalidAddress) {
      return res.status(400).send(`Invalid EVM address: ${invalidAddress}`);
    }

    const balances = await balanceChecker.run(addressArray);
    if (balances) {
      res.json(balances);
    } else {
      res.status(404).send("Addresses not found");
    }
  });

  app.get("/groups", async (req, res) => {
    const addresses = req.query.addresses as string | undefined;
    if (!addresses) {
      return res.status(400).send("Addresses query parameter is required");
    }

    const addressArray = addresses.split(",");
    const invalidAddress = addressArray.find(
      (address: string) => !ethers.isAddress(address)
    );
    if (invalidAddress) {
      return res.status(400).send(`Invalid EVM address: ${invalidAddress}`);
    }

    const results = await groupChecker.run(addressArray);
    if (results) {
      res.json(results);
    } else {
      res.status(404).send("Addresses not found");
    }
  });

  app.listen(3000, () => {
    console.log("listening on port 3000!");
  });
}

main();
