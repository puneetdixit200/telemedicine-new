const { z } = require('zod');

const bookSchema = z.object({
  slotId: z.string().uuid(),
  mode: z.enum(['video', 'audio', 'text']).default('video'),
  familyMemberId: z.string().uuid().optional().or(z.literal('')),
  problemDescription: z.string().max(4000).optional().or(z.literal('')),
  medicationsText: z.string().max(4000).optional().or(z.literal(''))
});

const preconsultSchema = z.object({
  problemDescription: z.string().max(4000).optional().or(z.literal('')),
  medicationsText: z.string().max(4000).optional().or(z.literal(''))
});

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(1000).optional().or(z.literal(''))
});

const noShowFollowUpSchema = z.object({
  reason: z.string().max(280).optional().or(z.literal('')),
  message: z.string().max(1600).optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(120).optional().or(z.literal(''))
});

module.exports = { bookSchema, preconsultSchema, reviewSchema, noShowFollowUpSchema };
