import Web3 from "web3";
import { newKit } from "@celo/contractkit";
import { bitIsSet, parseBlockExtraData } from "@celo/utils/lib/istanbul";
import winston from "winston";
import express from "express";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: {},
  transports: [new winston.transports.Console()],
});

const app = express();

const web3 = new Web3("https://forno.celo.org");
const kit = newKit("https://forno.celo.org");

const signerAddresses = [
  "0x2aD6D354e3aB2A196B64964a788534fdF7932e2B",
  "0xa9EA63861543ddb45bC192520DA0439495427364",
];

let signedValidators: string[] = [];
let unsignedValidatorsAll: string[] = [];

class ValidatorSignatureChecker {
  async run(blockNum: number) {
    const electedSigners = signerAddresses;
    const [block, election] = await Promise.all([
      web3.eth.getBlock(blockNum),
      kit.contracts.getElection(),
    ]);

    const bitmap = parseBlockExtraData(block?.extraData).parentAggregatedSeal
      .bitmap;

    const signers = await election.getCurrentValidatorSigners();

    electedSigners.forEach((e, i) => {
      if (!signers.includes(e)) {
        logger.info(`Signer ${electedSigners[i]} is not elected`);
        electedSigners.splice(i, 1);
        // throw new Error(`Signer ${addresses[i]} is not elected`)
      }
    });

    const unsignedValidators = signers.filter((signer, index) => {
      return !bitIsSet(bitmap, index);
    });

    if (unsignedValidators.length > 0) {
      unsignedValidatorsAll = unsignedValidators;

      electedSigners.forEach((e, i) => {
        if (!unsignedValidators.includes(e)) {
          if (!signedValidators.includes(electedSigners[i])) {
            signedValidators.push(electedSigners[i]);
          }

          logger.info(`${electedSigners[i]} signed on block ${blockNum}`);
        } else {
          if (signedValidators.includes(electedSigners[i])) {
            signedValidators.splice(
              signedValidators.indexOf(electedSigners[i]),
              1
            );
          }

          logger.info(
            `${electedSigners[i]} missed signing on block ${blockNum}`
          );
        }
      });

      logger.info(
        `Unsigned validators at block ${blockNum}\n${unsignedValidators}`
      );
    } else {
      unsignedValidatorsAll = [];
      logger.info(`No unsigned validators at block ${blockNum}`);
    }

    logger.info(`--------- next cycle ---------\n`);
  }
}

async function main() {
  app.get("/signed", (req, res) => {
    res.send(`${signedValidators}`);
  });

  app.get("/unsignedAll", (req, res) => {
    res.send(`${unsignedValidatorsAll}`);
  });

  app.listen(3000, () => {
    console.log("listening on port 3000!");
  });

  try {
    const checker = new ValidatorSignatureChecker();

    function loop() {
      const blockNumberPromise = web3.eth.getBlockNumber();

      blockNumberPromise.then(async (blockNumber) => {
        await checker.run(blockNumber);
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
}

main();
