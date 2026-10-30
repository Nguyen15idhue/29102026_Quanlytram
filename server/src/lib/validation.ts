import { z } from 'zod';

export const emailField = z.union([z.literal(''), z.string().email().max(190)]);
