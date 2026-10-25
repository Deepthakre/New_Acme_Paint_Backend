import { Schema, model } from 'mongoose';

export type CounterName = 'product' | 'carton' | 'batch' | 'accSku' | 'order' | 'invoice' | 'voucher' | 'painter' | 'payout' | 'campaign' | 'fraudFlag';

interface ICounter {
  _id: CounterName;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = model<ICounter>('Counter', counterSchema);

/**
 * Atomically increments and returns the next value for a named sequence.
 * Using findOneAndUpdate with $inc (rather than read-then-write in app
 * code) is what keeps QR/batch/order/invoice numbering collision-free
 * under concurrent requests — two warehouse staff starting a batch at the
 * same instant can never receive the same batch id.
 */
export async function nextSeq(name: CounterName, incrementBy = 1): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: incrementBy } },
    { upsert: true, new: true }
  ).lean();
  return doc!.seq;
}

/** Returns the range [firstSeqUsed, lastSeqUsed] after reserving `count` sequence numbers. */
export async function reserveSeqRange(name: CounterName, count: number): Promise<{ start: number; end: number }> {
  const end = await nextSeq(name, count);
  return { start: end - count + 1, end };
}

export { Counter };
