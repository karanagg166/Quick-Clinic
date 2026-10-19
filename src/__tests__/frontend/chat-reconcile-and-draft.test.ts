import { describe, it, expect } from 'vitest';
import { reconcileMessages, Message } from '@/components/general/ChatBar';

describe('ChatBar Message Reconciliation & Idempotency Rules', () => {
  it('reconciles optimistic message with incoming canonical server message without duplicates', () => {
    const clientMessageId = 'msg_client_12345';
    const initialList: Message[] = [
      {
        id: clientMessageId,
        clientMessageId,
        text: 'Hello doctor',
        senderId: 'pat_1',
        createdAt: '2026-10-19T10:00:00.000Z',
        status: 'pending',
      },
    ];

    const incomingServerMessage: Message = {
      id: 'db_uuid_server_999',
      clientMessageId,
      text: 'Hello doctor',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:00:01.000Z',
      status: 'sent',
    };

    const merged = reconcileMessages(initialList, [incomingServerMessage]);

    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('db_uuid_server_999');
    expect(merged[0].clientMessageId).toBe(clientMessageId);
    expect(merged[0].status).toBe('sent');
  });

  it('handles broadcast arriving BEFORE acknowledgement without duplicate creation', () => {
    const clientMessageId = 'msg_race_111';
    const optimisticMessage: Message = {
      id: clientMessageId,
      clientMessageId,
      text: 'Fast broadcast message',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:02:00.000Z',
      status: 'pending',
    };

    const broadcastMessage: Message = {
      id: 'server_broadcast_uuid',
      clientMessageId,
      text: 'Fast broadcast message',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:02:00.500Z',
      status: 'sent',
    };

    // 1. User sends message -> optimistic insert
    let list = reconcileMessages([], [optimisticMessage]);
    expect(list.length).toBe(1);
    expect(list[0].status).toBe('pending');

    // 2. Broadcast arrives before ack
    list = reconcileMessages(list, [broadcastMessage]);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('server_broadcast_uuid');
    expect(list[0].status).toBe('sent');

    // 3. Late ack arrives later with same clientMessageId and server ID
    const ackMessage: Message = {
      id: 'server_broadcast_uuid',
      clientMessageId,
      text: 'Fast broadcast message',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:02:00.500Z',
      status: 'sent',
    };
    list = reconcileMessages(list, [ackMessage]);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('server_broadcast_uuid');
    expect(list[0].status).toBe('sent');
  });

  it('reconciles late acknowledgement after timeout has marked message as failed', () => {
    const clientMessageId = 'msg_late_ack_222';
    // Timeout marked the message as failed
    const failedMessage: Message = {
      id: clientMessageId,
      clientMessageId,
      text: 'Did this send?',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:05:00.000Z',
      status: 'failed',
    };

    const initialList = [failedMessage];

    // Late server ack finally arrives with canonical record
    const serverAck: Message = {
      id: 'server_late_uuid_555',
      clientMessageId,
      text: 'Did this send?',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:05:02.000Z',
      status: 'sent',
    };

    const reconciled = reconcileMessages(initialList, [serverAck]);

    expect(reconciled.length).toBe(1);
    expect(reconciled[0].id).toBe('server_late_uuid_555');
    expect(reconciled[0].status).toBe('sent');
  });

  it('preserves both messages when user deliberately sends two identical-text messages with different IDs', () => {
    const msg1: Message = {
      id: 'db_id_1',
      clientMessageId: 'client_id_1',
      text: 'Yes please',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:10:00.000Z',
      status: 'sent',
    };

    const msg2: Message = {
      id: 'db_id_2',
      clientMessageId: 'client_id_2',
      text: 'Yes please',
      senderId: 'pat_1',
      createdAt: '2026-10-19T10:10:05.000Z',
      status: 'sent',
    };

    const list = reconcileMessages([msg1], [msg2]);

    expect(list.length).toBe(2);
    expect(list[0].id).toBe('db_id_1');
    expect(list[1].id).toBe('db_id_2');
    expect(list[0].text).toBe(list[1].text);
  });

  it('maintains strict chronological ordering by createdAt', () => {
    const older: Message = {
      id: 'msg_older',
      clientMessageId: 'cid_older',
      text: 'First message',
      senderId: 'pat_1',
      createdAt: '2026-10-19T09:00:00.000Z',
      status: 'sent',
    };

    const newer: Message = {
      id: 'msg_newer',
      clientMessageId: 'cid_newer',
      text: 'Second message',
      senderId: 'pat_1',
      createdAt: '2026-10-19T09:05:00.000Z',
      status: 'sent',
    };

    // Arrive in reverse order
    const list = reconcileMessages([newer], [older]);

    expect(list.length).toBe(2);
    expect(list[0].id).toBe('msg_older');
    expect(list[1].id).toBe('msg_newer');
  });
});
