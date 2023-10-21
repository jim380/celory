import express from "express";
import dotenv from "dotenv";
import Web3 from "web3";
import winston from "winston";
import { ValidatorSignatureChecker } from "./signature";

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
  const web3 = new Web3(rpcUrl);

  let unsignedValidatorsMonitored: string[] = [];
  let unsignedValidatorsAll: string[] = [];

  try {
    const signatureChecker = new ValidatorSignatureChecker(
      rpcUrl,
      signerAddresses,
      logger
    );

    function loop() {
      const blockNumberPromise = web3.eth.getBlockNumber();

      blockNumberPromise.then(async (blockNumber) => {
        const result = await signatureChecker.run(blockNumber);
        unsignedValidatorsMonitored = result.unsignedValidatorsMonitored;
        unsignedValidatorsAll = result.unsignedValidatorsAll;
        setTimeout(loop, 3000);
      });
      blockNumberPromise.catch((error) => {
        logger.error("Error getting block number:", error);
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
      unsignedValidatorsMonitored.length > 0
        ? unsignedValidatorsMonitored
        : "true";
    res.send(`${response}`);
  });

  app.get("/unsigned-all", (req, res) => {
    const response =
      unsignedValidatorsAll.length > 0
        ? unsignedValidatorsAll
        : "No unsigned validators on this block";
    res.send(`${response}`);
  });

  app.listen(3000, () => {
    console.log("listening on port 3000!");
  });
}

main();
