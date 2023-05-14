/**
 * Types for OSMCha API
 *
 * Contains types for a response from the changesets endpoint of the OSMCha API
 */
import { FeatureCollection, Feature } from "geojson";

/**
 * OSMCha API Response for changesets
 */
export interface APIResponse extends FeatureCollection {
  count: number;
  next: string | null;
  previous: string | null;
  features: Changeset[];
}

/**
 * OSMCha representation of a changeset
 */
export interface Changeset extends Feature {
  id: number;
  properties: {
    check_user: string | null;
    reasons: string[];
    tags: string[];
    features: string[];
    user: string;
    uid: string;
    editor: string;
    comment: string;
    comments_count: number;
    source: string;

    /**
     * Imagery used for the changeset
     * Defaults to "Not reported" if not set
     */
    imagery_used: string | "Not reported";

    date: string;
    reviewed_features: unknown;

    /**
     * Changes made to tags of objects
     */
    tag_changes: {
      [key: string]: string[];
    };

    create: number;
    modify: number;
    delete: number;
    bbox: string;
    area: number;
    is_suspect: boolean;
    harmful: boolean;
    checked: boolean;
    check_date: string | null;

    /**
     * Original changeset tags
     */
    metadata: {
      [key: string]: string;
    };
  };
}
