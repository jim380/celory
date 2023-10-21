import Web3 from "web3";
import { ContractKit, newKit } from "@celo/contractkit";
import { bitIsSet, parseBlockExtraData } from "@celo/utils/lib/istanbul";
import winston from "winston";

export interface ValidatorSignatureResult {
  unsignedValidatorsMonitored: string[];
  unsignedValidatorsAll: string[];
}

export class ValidatorSignatureChecker {
  kit: ContractKit;
  web3: Web3;
  signerAddresses: string[];
  logger: winston.Logger;

  constructor(
    rpcUrl: string,
    signerAddresses: string[],
    logger: winston.Logger
  ) {
    this.kit = newKit(rpcUrl);
    this.web3 = new Web3(rpcUrl);
    this.signerAddresses = signerAddresses;
    this.logger = logger;
  }

  async run(blockNum: number): Promise<ValidatorSignatureResult> {
    let unsignedValidatorsMonitored: string[] = [];
    let unsignedValidatorsAll: string[] = [];

    const monitoredSigners = this.signerAddresses;
    const [block, election] = await Promise.all([
      this.web3.eth.getBlock(blockNum),
      this.kit.contracts.getElection(),
    ]);

    const bitmap = parseBlockExtraData(block?.extraData).parentAggregatedSeal
      .bitmap;

    const signers = await election.getCurrentValidatorSigners();

    // Remove monitored signers that are not elected
    monitoredSigners.forEach((e, i) => {
      if (!signers.includes(e)) {
        this.logger.info(`Signer ${monitoredSigners[i]} is not elected`);
        monitoredSigners.splice(i, 1);
      }
    });

    const unsignedValidators = signers.filter((signer, index) => {
      return !bitIsSet(bitmap, index);
    });

    if (unsignedValidators.length > 0) {
      unsignedValidatorsAll = unsignedValidators;

      // find monitored signers that are unsigned
      monitoredSigners.forEach((e, i) => {
        if (unsignedValidators.includes(e)) {
          unsignedValidatorsMonitored.push(e);
          this.logger.info(`${e} missed signing on block ${blockNum}`);
        } else {
          this.logger.info(`${e} signed on block ${blockNum}`);
        }
      });

      this.logger.info(
        `Unsigned monitored validators at block ${blockNum}: ${
          unsignedValidatorsMonitored.length > 0
            ? unsignedValidatorsMonitored
            : "None"
        }}}`
      );

      this.logger.info(
        `Unsigned validators at block ${blockNum}: ${unsignedValidators}`
      );
    } else {
      this.logger.info(`No unsigned validators at block ${blockNum}`);
    }

    const result: ValidatorSignatureResult = {
      unsignedValidatorsMonitored,
      unsignedValidatorsAll,
    };

    return result;
  }
}
