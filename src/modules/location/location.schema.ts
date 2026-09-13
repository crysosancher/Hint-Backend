import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LocationDocument = HydratedDocument<Location>;

/**
 * GeoJSON Point (RFC 7946). Coordinates are stored `[longitude, latitude]` —
 * longitude first — which is the GeoJSON order, not the more familiar
 * "lat, lng". Getting this backwards silently breaks geospatial queries, so
 * the conversion lives in exactly one place (see `LocationService.persist`).
 */
@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type!: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates!: [number, number];
}

export const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

/**
 * A user's latest valid location, keyed by a unique `userId`.
 *
 * Only the most recent fix is kept — every update upserts the same document —
 * because the MVP deliberately avoids a movement history to minimise location
 * retention (architecture spec, "Location & Nearby Mode").
 */
@Schema({ timestamps: true, collection: 'locations' })
export class Location {
  _id!: Types.ObjectId;

  /** Owner. Unique: a user has at most one latest location. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: GeoPointSchema, required: true })
  location!: GeoPoint;

  /** Reported horizontal accuracy in metres; poor fixes are rejected on ingest. */
  @Prop({ type: Number, required: true, min: 0 })
  accuracyMeters!: number;

  createdAt!: Date;

  updatedAt!: Date;
}

export const LocationSchema = SchemaFactory.createForClass(Location);

// 2dsphere index powers the server-authoritative 250 m query in Phase 3.
LocationSchema.index({ location: '2dsphere' });
