import { ContractKit, newKit } from "@celo/contractkit";
import { bitIsSet, parseBlockExtraData } from "@celo/utils/lib/istanbul";
import { ethers } from "ethers";
import winston from "winston";
import { DatabaseService } from "./Database";

export interface SignatureCheckerResult {
  unsignedValidatorsMonitored: string[];
  unsignedValidatorsAll: string[];
}

export class SignatureChecker {
  kit: ContractKit;
  provider: ethers.JsonRpcProvider;
  signerAddresses: string[];
  logger: winston.Logger;
  dbService: DatabaseService;

  constructor(
    rpcUrl: string,
    signerAddresses: string[],
    logger: winston.Logger,
    dbService: DatabaseService
  ) {
    this.kit = newKit(rpcUrl);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signerAddresses = signerAddresses;
    this.logger = logger;
    this.dbService = dbService;
  }

  async run(blockNum: number): Promise<SignatureCheckerResult> {
    let unsignedValidatorsMonitored: string[] = [];
    let unsignedValidatorsAll: string[] = [];

    const monitoredSigners = this.signerAddresses;
    const [block, election] = await Promise.all([
      this.provider.getBlock(blockNum),
      this.kit.contracts.getElection(),
    ]);

    const bitmap = parseBlockExtraData(block?.extraData!).parentAggregatedSeal
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

      // Persist unsigned validators
      for (const validator of unsignedValidatorsAll) {
        await this.dbService.saveUnsignedValidator(blockNum, validator);
      }

      // Find monitored signers that are unsigned
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
        }`
      );

      this.logger.info(
        `Unsigned validators at block ${blockNum}: ${unsignedValidators}`
      );
    } else {
      this.logger.info(`No unsigned validators at block ${blockNum}`);
    }

    const result: SignatureCheckerResult = {
      unsignedValidatorsMonitored,
      unsignedValidatorsAll,
    };

    return result;
  }
}
