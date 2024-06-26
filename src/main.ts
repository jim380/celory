import express from "express";
import dotenv from "dotenv";
import { ethers } from "ethers";
import winston from "winston";
import { SignatureChecker, SignatureCheckerResult } from "./SignatureChecker";
import { BalanceChecker } from "./BalanceChecker";
import { GroupChecker } from "./GroupChecker";
import { GovChecker } from "./GovChecker";
import { abi as validatorGroupImplAbi } from "./abis/ValidatorGroupImpl.json";
import { abi as accountImplAbi } from "./abis/AccountImpl.json";
import { abi as electionImplAbi } from "./abis/ElectionImpl.json";
import { abi as govImplAbi } from "./abis/GovImpl.json";
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

  const govProxy = new ethers.Contract(
    "0xD533Ca259b330c7A88f74E000a3FaEa2d63B7972", // proxy
    govImplAbi,
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

  const govChecker = new GovChecker(rpcUrl, govProxy, logger, dbService);

  let unsignedValidators: SignatureCheckerResult;
  let latestBlockNumber: number;

  try {
    async function loop() {
      try {
        latestBlockNumber = await provider.getBlockNumber();

        // signature
        unsignedValidators = await signatureChecker.run(latestBlockNumber);

        // groups
        const registeredGroups =
          await validatorProxy.getRegisteredValidatorGroups();
        const eligibleGroups = await electionProxy.getEligibleValidatorGroups();
        const uniqueGroups = [
          ...new Set([...registeredGroups, ...eligibleGroups]),
        ];
        await groupChecker.save(uniqueGroups as string[]);

        // gov
        const proposalCount = await govProxy.proposalCount();
        await govChecker.save(proposalCount);
      } catch (error) {
        logger.error("Error in loop function:", error);
      } finally {
        setTimeout(loop, 3000);
      }
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

  app.get("/unsigned-all", async (req, res) => {
    let height = req.query.height as string | undefined;

    try {
      let blockNum: number;
      if (!height) {
        blockNum = latestBlockNumber;
      } else {
        blockNum = parseInt(height, 10);
        if (isNaN(blockNum)) {
          return res.status(400).send("Invalid height query parameter");
        }
      }

      const unsignedValidators = await dbService.getUnsignedValidators(
        blockNum
      );
      const response =
        unsignedValidators.length > 0
          ? unsignedValidators
          : "No unsigned validators on this block";
      res.json({ response });
    } catch (error) {
      logger.error("Error fetching unsigned validators:", error);
      res.status(500).send("Internal server error");
    }
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

    const results = await groupChecker.dbService.getGroupInfo(addressArray);
    if (results) {
      res.json(results);
    } else {
      res.status(404).send("Addresses not found");
    }
  });

  app.get("/validators", async (req, res) => {
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

    const results = await groupChecker.dbService.getValidatorInfo(addressArray);
    if (results) {
      res.json(results);
    } else {
      res.status(404).send("Addresses not found");
    }
  });

  app.get("/proposals", async (req, res) => {
    var results;
    const ids = req.query.ids as string | undefined;
    if (!ids) {
      const proposalCount = await govProxy.proposalCount();
      const proposalIds: string[] = [];
      for (let i = 1n; i <= proposalCount; i++) {
        proposalIds.push(i.toString());
      }
      results = await govChecker.dbService.getProposalInfo(proposalIds);
    } else {
      const idArray = ids.split(",");
      results = await govChecker.dbService.getProposalInfo(idArray);
    }
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
