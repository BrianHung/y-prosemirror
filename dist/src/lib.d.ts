/**
 * Utility method to convert a Prosemirror Doc Node into a Y.Doc.
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * @param {Node} doc
 * @param {string} xmlFragment
 * @return {Y.Doc}
 */
export function prosemirrorToYDoc(doc: Node, xmlFragment?: string): any;
/**
 * Utility method to convert Prosemirror compatible JSON into a Y.Doc.
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * @param {Schema} schema
 * @param {any} state
 * @param {string} xmlFragment
 * @return {Y.Doc}
 */
export function prosemirrorJSONToYDoc(schema: Schema, state: any, xmlFragment?: string): any;
/**
 * Utility method to convert a Y.Doc to a Prosemirror Doc node.
 *
 * @param {Schema} schema
 * @param {Y.Doc} ydoc
 * @return {Node}
 */
export function yDocToProsemirror(schema: Schema, ydoc: any): Node;
/**
 * Utility method to convert a Y.Doc to Prosemirror compatible JSON.
 *
 * @param {Y.Doc} ydoc
 * @param {string} xmlFragment
 * @return {Record<string, any>}
 */
export function yDocToProsemirrorJSON(ydoc: any, xmlFragment?: string): Record<string, any>;
export function setMeta(view: any, key: any, value: any): void;
export function absolutePositionToRelativePosition(pos: number, type: any, mapping: Map<any, Node<any> | Node<any>[]>): any;
export function relativePositionToAbsolutePosition(y: any, documentType: any, relPos: any, mapping: Map<any, Node<any> | Node<any>[]>): null | number;
/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 */
export type ProsemirrorMapping = Map<any, Node<any> | Node<any>[]>;
import { Node } from "prosemirror-model";
import { Schema } from "prosemirror-model";
