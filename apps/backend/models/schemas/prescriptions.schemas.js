const { z } = require('zod');

const upsertSchema = z.object({
  diagnosis: z.string().min(2).max(500),
  itemsText: z.string().max(4000).optional().or(z.literal('')),
  medicationName: z.union([z.string(), z.array(z.string())]).optional(),
  dosage: z.union([z.string(), z.array(z.string())]).optional(),
  frequency: z.union([z.string(), z.array(z.string())]).optional(),
  duration: z.union([z.string(), z.array(z.string())]).optional(),
  sideEffects: z.union([z.string(), z.array(z.string())]).optional(),
  instructions: z.string().optional().or(z.literal('')),
  followUpAt: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  pharmacyName: z.string().max(180).optional().or(z.literal('')),
  pharmacyContact: z.string().max(180).optional().or(z.literal(''))
});

module.exports = { upsertSchema };
