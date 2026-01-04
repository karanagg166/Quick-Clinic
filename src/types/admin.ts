export type Log = {
    id: string;
    userId: string | null;
    user?: {
        name: string;
        email: string;
        role: string;
    };
    action: string;
    metadata?: any;
    targetId?: string;
    createdAt: string;
};
