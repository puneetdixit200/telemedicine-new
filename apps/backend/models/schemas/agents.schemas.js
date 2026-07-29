const { z } = require('zod');

const uuid = z.string().uuid();

const createPlanSchema = z.object({
  reason: z.string().trim().max(600).optional().or(z.literal('')),
  preferredLanguage: z.string().trim().max(40).optional().or(z.literal(''))
});

const approveActionsSchema = z.object({
  actionIds: z.array(uuid).min(1).max(10)
});

const rejectActionsSchema = z.object({
  actionIds: z.array(uuid).min(1).max(10),
  reason: z.string().trim().max(500).optional().or(z.literal(''))
});

module.exports = {
  createPlanSchema,
  approveActionsSchema,
  rejectActionsSchema
};
