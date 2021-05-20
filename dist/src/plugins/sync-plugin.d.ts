export function isVisible(item: any, snapshot?: any): boolean;
export function ySyncPlugin(yXmlFragment: any, { colors, colorMapping, permanentUserData, initialContent }?: YSyncOpts): any;
export function getRelativeSelection(pmbinding: any, state: any): {
    anchor: any;
    head: any;
};
/**
 * Binding for prosemirror.
 *
 * @protected
 */
export class ProsemirrorBinding {
    /**
     * @param {Y.XmlFragment} yXmlFragment The bind source
     * @param {any} prosemirrorView The target binding
     */
    constructor(yXmlFragment: any, prosemirrorView: any);
    type: any;
    prosemirrorView: any;
    mux: any;
    /**
     * @type {ProsemirrorMapping}
     */
    mapping: Map<any, PMNode<any> | PMNode<any>[]>;
    _observeFunction: any;
    /**
     * @type {Y.Doc}
     */
    doc: any;
    /**
     * current selection as relative positions in the Yjs model
     */
    beforeTransactionSelection: {
        anchor: any;
        head: any;
    };
    beforeAllTransactions: () => void;
    afterAllTransactions: () => void;
    _domSelectionInView: boolean;
    _isLocalCursorInView(): boolean;
    _isDomSelectionInView(): boolean;
    renderSnapshot(snapshot: any, prevSnapshot: any): void;
    unrenderSnapshot(): void;
    _forceRerender(): void;
    /**
     * @param {Y.Snapshot} snapshot
     * @param {Y.Snapshot} prevSnapshot
     * @param {Object} pluginState
     */
    _renderSnapshot(snapshot: any, prevSnapshot: any, pluginState: any): void;
    /**
     * @param {Array<Y.YEvent>} events
     * @param {Y.Transaction} transaction
     */
    _typeChanged(events: Array<any>, transaction: any): void;
    _prosemirrorChanged(doc: any): void;
    destroy(): void;
}
export function updateYFragment(y: any, yDomFragment: any, pNode: any, mapping: Map<any, PMNode<any> | PMNode<any>[]>): void;
/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 */
export type ProsemirrorMapping = Map<any, PMNode<any> | PMNode<any>[]>;
export type ColorDef = {
    light: string;
    dark: string;
};
export type YSyncOpts = {
    colors?: Array<ColorDef>;
    colorMapping?: Map<string, ColorDef>;
    permanentUserData?: any | null;
    initialContent?: JSON | null;
};
export type NormalizedPNodeContent = (PMNode<any> | PMNode<any>[])[];
import { Node as PMNode } from "prosemirror-model";
