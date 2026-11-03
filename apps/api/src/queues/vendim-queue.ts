import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const VENDIM_QUEUE_NAME = "vendim-jobs";

export interface VendimJobData {
  leaveRequestId: string;
}

// P8.5: LibreOffice can take seconds, so the Vendim is made off the request
// path (worker.ts). A missing People field isn't retried (it's recorded on
// the request for HR); only unexpected errors are.
export const vendimQueue = new Queue<VendimJobData>(VENDIM_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export async function enqueueVendim(leaveRequestId: string) {
  await vendimQueue.add("vendim", { leaveRequestId });
}
