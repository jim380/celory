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

dotenv.config();

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
    logger
  );

  const balanceChecker = new BalanceChecker(rpcUrl, logger);
  const groupChecker = new GroupChecker(
    rpcUrl,
    validatorProxy,
    accountProxy,
    electionProxy,
    logger
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

  app.get("/total-balances/:addresses", async (req, res) => {
    const addresses = req.params.addresses.split(",");
    const invalidAddress = addresses.find(
      (address) => !ethers.isAddress(address)
    );
    if (invalidAddress) {
      return res.status(400).send(`Invalid EVM address: ${invalidAddress}`);
    }

    const balances = await balanceChecker.run(addresses);
    if (balances) {
      res.json(balances);
    } else {
      res.status(404).send("Addresses not found");
    }
  });

  app.get("/group/:addresses", async (req, res) => {
    const addresses = req.params.addresses.split(",");
    const invalidAddress = addresses.find(
      (address) => !ethers.isAddress(address)
    );
    if (invalidAddress) {
      return res.status(400).send(`Invalid EVM address: ${invalidAddress}`);
    }

    const results = await groupChecker.run(addresses);
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
