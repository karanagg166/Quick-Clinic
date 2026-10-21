import { prisma } from "@/lib/prisma";
import {
  persistChatMessage as persistChatMessageInternal,
  formatChatMessage,
  PersistChatMessageInput as BaseInput,
  PersistChatMessageResult,
  FormattedChatMessage,
} from "../../socket-server/chat-persistence";

export type { PersistChatMessageResult, FormattedChatMessage };

export interface PersistChatMessageInput extends Omit<BaseInput, "prismaClient"> {
  prismaClient?: any;
}

export async function persistChatMessage(input: PersistChatMessageInput): Promise<PersistChatMessageResult> {
  return persistChatMessageInternal({
    ...input,
    prismaClient: input.prismaClient || prisma,
  });
}

export { formatChatMessage };
