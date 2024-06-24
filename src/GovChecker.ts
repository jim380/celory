import { ethers } from "ethers";
import Decimal from "decimal.js";
import { ContractKit, newKit } from "@celo/contractkit";
import winston from "winston";
import { DatabaseService } from "./Database";

interface proposer {
  address: string;
  deposit: string;
  timestamp: string;
}

interface votes {
  total: string;
  yes: string;
  no: string;
  abstain: string;
}

interface dequeue {
  status: string;
  index: string;
  address: string;
  timestamp: string;
}

interface approval {
  status: string;
  address: string;
  timestamp: string;
}

interface executed {
  from: string;
  timestamp: string;
  blockNumber: string;
  txHash: string;
}

enum proposalStage {
  None,
  Queued,
  Approval,
  Referendum,
  Execution,
  Expiration,
}

export interface GovCheckerResult {
  id: string;
  status: string;
  timespan: string;
  title: string;
  description: string;
  proposer: proposer;
  upvotes: string;
  votes: votes;
  dequeue: dequeue;
  approved: approval;
  executed: executed;
}

export class GovChecker {
  kit: ContractKit;
  provider: ethers.JsonRpcProvider;
  logger: winston.Logger;
  govProxy: ethers.Contract;
  dbService: DatabaseService;

  constructor(
    rpcUrl: string,
    govProxy: ethers.Contract,
    logger: winston.Logger,
    dbService: DatabaseService
  ) {
    this.kit = newKit(rpcUrl);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.govProxy = govProxy;
    this.logger = logger;
    this.dbService = dbService;
  }

  async save(count: bigint): Promise<GovCheckerResult[]> {
    const results: GovCheckerResult[] = await Promise.all(
      Array.from({ length: Number(count) }, (_, id) => id).map(async (id) => {
        const proposal = await this.govProxy.getProposal(id);
        const stage = await this.govProxy.getProposalStage(id);
        const votes = await this.govProxy.getVoteTotals(id);
        const upvotes = await this.getUpvotes(id);
        const dequeued = await this.isDequeued(id);
        let dequeueIndex = "";
        if (dequeued) {
          dequeueIndex = (await this.getDequeueIndex(id)).toString();
        }
        const approved = await this.isApproved(id);

        const result: GovCheckerResult = {
          id: id.toString(),
          status: this.getProposalStage(Number(stage)),
          timespan: "0",
          title: "0",
          description: proposal[4].toString(),
          proposer: {
            address: proposal[0],
            deposit: proposal[1].toString(),
            timestamp: proposal[2].toString(),
          },
          upvotes: upvotes,
          votes: {
            total: (votes[0] + votes[1] + votes[2]).toString(),
            yes: votes[0].toString(),
            no: votes[1].toString(),
            abstain: votes[2].toString(),
          },
          dequeue: {
            status: dequeued.toString(),
            index: dequeueIndex.toString(),
            address: "0", // TO-DO figure out how to get dequeue data
            timestamp: "0",
          },
          approved: {
            status: approved.toString(),
            address: "0", // TO-DO figure out how to get approval data
            timestamp: "0",
          },
          executed: {
            // TO-DO figure out how to get execution data
            from: "0",
            timestamp: "0",
            blockNumber: "0",
            txHash: "0",
          },
        };

        await this.dbService.upsertProposal(result);

        return result;
      })
    );

    return results;
  }

  getProposalStage(stage: number): string {
    switch (stage) {
      case 0:
        return proposalStage[proposalStage.None];
      case 1:
        return proposalStage[proposalStage.Queued];
      case 2:
        return proposalStage[proposalStage.Approval];
      case 3:
        return proposalStage[proposalStage.Referendum];
      case 4:
        return proposalStage[proposalStage.Execution];
      case 5:
        return proposalStage[proposalStage.Expiration];
    }
    throw new Error("Invalid proposal stage");
  }

  async getUpvotes(id: number): Promise<string> {
    const queue = await this.govProxy.getQueue();
    if (!queue || !queue.ids || !queue.upvotes) {
      return "0";
    }
    const { ids, upvotes } = queue;
    const index = ids.indexOf(id);
    if (index === -1) {
      this.logger.error(`Proposal ${id} is not queued`);
      return "0";
    }
    return upvotes[index].toString();
  }

  async isDequeued(id: number): Promise<boolean> {
    const ids: bigint[] = await this.govProxy.getDequeue();
    return ids.includes(BigInt(id));
  }

  async isApproved(id: number): Promise<boolean> {
    const approved = await this.govProxy.isApproved(id);
    return approved;
  }

  async getDequeueIndex(id: number): Promise<number> {
    const ids: bigint[] = await this.govProxy.getDequeue();
    return ids.indexOf(BigInt(id));
  }
}
