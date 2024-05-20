import { ethers } from "ethers";
import Decimal from "decimal.js";
import { ContractKit, newKit } from "@celo/contractkit";
import winston from "winston";

interface votes {
  total: string;
  active: string;
  pending: string;
  receivable: string;
}

interface members {
  address: string;
  voteSinger: string;
  elected: boolean;
  score: string;
}

interface metadata {
  domain: string;
}

export interface GroupCheckerResult {
  name: string;
  address: string;
  isEligible: boolean;
  votes: votes;
  members: members[];
  commission: number;
  lastSlashed: string;
  domain: string;
  voteSigner: string;
}

export class GroupChecker {
  kit: ContractKit;
  provider: ethers.JsonRpcProvider;
  logger: winston.Logger;
  validatorProxy: ethers.Contract;
  accountProxy: ethers.Contract;
  electionProxy: ethers.Contract;

  constructor(
    rpcUrl: string,
    validatorProxy: ethers.Contract,
    accountProxy: ethers.Contract,
    electionProxy: ethers.Contract,
    logger: winston.Logger
  ) {
    this.kit = newKit(rpcUrl);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.logger = logger;
    this.validatorProxy = validatorProxy;
    this.accountProxy = accountProxy;
    this.electionProxy = electionProxy;
  }

  async run(addresses: string[]): Promise<GroupCheckerResult[]> {
    const results: GroupCheckerResult[] = await Promise.all(
      addresses.map(async (address) => {
        const groupInfo = await this.validatorProxy.getValidatorGroup(address);
        const members = await this.getMemberInfo(groupInfo[0]);
        const metadata = await this.getMetadata(address);

        const commission = new Decimal(groupInfo[1].toString());
        const multiplier = new Decimal(groupInfo[5].toString());

        return {
          name: await this.getName(address),
          address: address,
          isEligible: await this.isGroupEligible(address),
          votes: await this.getVotes(address),
          members: members,
          commission: commission.div(multiplier).toNumber(),
          lastSlashed: groupInfo[6].toString(),
          voteSigner: await this.getVoteSigner(address),
          domain: metadata.domain,
        };
      })
    );

    return results;
  }

  async isGroup(address: string): Promise<boolean> {
    return this.validatorProxy.isValidatorGroup(address);
  }

  async isGroupEligible(address: string): Promise<boolean> {
    return this.electionProxy.getGroupEligibility(address);
  }

  async getName(address: string): Promise<string> {
    return this.accountProxy.getName(address);
  }

  async getVotes(address: string): Promise<votes> {
    const total = (
      await this.electionProxy.getTotalVotesForGroup(address)
    ).toString();
    const active = (
      await this.electionProxy.getActiveVotesForGroup(address)
    ).toString();
    const pending = (
      await this.electionProxy.getPendingVotesForGroup(address)
    ).toString();
    const receivable = (
      await this.electionProxy.getNumVotesReceivable(address)
    ).toString();

    return { total, active, pending, receivable };
  }

  async getMemberInfo(members: any): Promise<members[]> {
    const memberPromises = members.map(async (member: string) => {
      const validatorInfo = await this.validatorProxy.getValidator(member);

      return {
        address: member,
        voteSinger: await this.getVoteSigner(member),
        elected: await this.isElected(validatorInfo),
        score: validatorInfo[3].toString(),
      };
    });

    return Promise.all(memberPromises);
  }

  async isElected(validatorInfo: any): Promise<boolean> {
    const election = await this.kit.contracts.getElection();
    const signers = await election.getCurrentValidatorSigners();
    if (signers.includes(validatorInfo[4])) {
      return true;
    }
    return false;
  }

  async getVoteSigner(address: string): Promise<string> {
    return this.accountProxy.getVoteSigner(address);
  }

  async getMetadata(address: string): Promise<metadata> {
    try {
      let url = await this.accountProxy.getMetadataURL(address);

      // Add default scheme if missing
      if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
      }

      // Validate the URL
      new URL(url);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata for ${address}`);
      }

      const data = await response.json();
      const domain = data.claims.find(
        (claim: any) => claim.type === "DOMAIN"
      ).domain;

      return { domain };
    } catch (error) {
      this.logger.error(`Error fetching metadata for ${address}:`, error);
      return { domain: "" };
    }
  }
}
