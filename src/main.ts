import express from "express";
import dotenv from "dotenv";
import { ethers } from "ethers";
import winston from "winston";
import { SignatureChecker, SignatureCheckerResult } from "./SignatureChecker";
import { BalanceChecker, BalanceCheckerResult } from "./BalanceChecker";

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
const walletAddresses = process.env.WALLET_ADDRESSES?.split(",") || [];

async function main() {
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let totalBalance: BalanceCheckerResult;
  let unsignedValidators: SignatureCheckerResult;

  try {
    const signatureChecker = new SignatureChecker(
      rpcUrl,
      signerAddresses,
      logger
    );

    const balanceChecker = new BalanceChecker(rpcUrl, walletAddresses, logger);

    function loop() {
      provider
        .getBlockNumber()
        .then(async (blockNumber) => {
          // signature
          unsignedValidators = await signatureChecker.run(blockNumber);

          // balance
          totalBalance = await balanceChecker.run();
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

  app.get("/total-balance", (req, res) => {
    res.json(totalBalance);
  });

  app.listen(3000, () => {
    console.log("listening on port 3000!");
  });
}

main();
