'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var Y = require('yjs');
var prosemirrorView = require('prosemirror-view');
var prosemirrorState = require('prosemirror-state');
require('y-protocols/dist/awareness.cjs');
var mutex_js = require('lib0/dist/mutex.cjs');
var prosemirrorModel = require('prosemirror-model');
var math = require('lib0/dist/math.cjs');
var object_js = require('lib0/dist/object.cjs');
var diff_js = require('lib0/dist/diff.cjs');
var error = require('lib0/dist/error.cjs');
var environment_js = require('lib0/dist/environment.cjs');
var dom_js = require('lib0/dist/dom.cjs');
var map = require('lib0/dist/map.cjs');
var eventloop = require('lib0/dist/eventloop.cjs');

/**
 * The unique prosemirror plugin key for syncPlugin
 *
 * @public
 */
const ySyncPluginKey = new prosemirrorState.PluginKey('y-sync');

/**
 * The unique prosemirror plugin key for undoPlugin
 *
 * @public
 */
const yUndoPluginKey = new prosemirrorState.PluginKey('y-undo');

/**
 * The unique prosemirror plugin key for cursorPlugin
 *
 * @public
 */
const yCursorPluginKey = new prosemirrorState.PluginKey('yjs-cursor');

/**
 * @module bindings/prosemirror
 */

/**
 * @param {Y.Item} item
 * @param {Y.Snapshot} [snapshot]
 */
const isVisible = (item, snapshot) => snapshot === undefined ? !item.deleted : (snapshot.sv.has(item.id.client) && /** @type {number} */ (snapshot.sv.get(item.id.client)) > item.id.clock && !Y.isDeleted(snapshot.ds, item.id));

/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 * @typedef {Map<Y.AbstractType, PMNode | Array<PMNode>>} ProsemirrorMapping
 */

/**
 * @typedef {Object} ColorDef
 * @property {string} ColorDef.light
 * @property {string} ColorDef.dark
 */

/**
 * @typedef {Object} YSyncOpts
 * @property {Array<ColorDef>} [YSyncOpts.colors]
 * @property {Map<string,ColorDef>} [YSyncOpts.colorMapping]
 * @property {Y.PermanentUserData|null} [YSyncOpts.permanentUserData]
 * @property {JSON|null} [YSyncOpts.initialContent]
 */

/**
 * @type {Array<ColorDef>}
 */
const defaultColors = [{ light: '#ecd44433', dark: '#ecd444' }];

/**
 * @param {Map<string,ColorDef>} colorMapping
 * @param {Array<ColorDef>} colors
 * @param {string} user
 * @return {ColorDef}
 */
const getUserColor = (colorMapping, colors, user) => {
  if (!colorMapping.has(user)) {
    colorMapping.set(user, colors[colorMapping.size % colors.length]);
  }
  return /** @type {ColorDef} */ (colorMapping.get(user));
};

/**
 * This plugin listens to changes in prosemirror view and keeps yXmlState and view in sync.
 *
 * This plugin also keeps references to the type and the shared document so other plugins can access it.
 * @param {Y.XmlFragment} yXmlFragment
 * @param {YSyncOpts} opts
 * @return {any} Returns a prosemirror plugin that binds to this type
 */
const ySyncPlugin = (yXmlFragment, { colors = defaultColors, colorMapping = new Map(), permanentUserData = null, initialContent = null } = {}) => {
  let changedInitialContent = false;
  const plugin = new prosemirrorState.Plugin({
    props: {
      editable: (state) => {
        const syncState = ySyncPluginKey.getState(state);
        return syncState.snapshot == null && syncState.prevSnapshot == null
      }
    },
    key: ySyncPluginKey,
    state: {
      init: (initargs, state) => {
        return {
          type: yXmlFragment,
          doc: yXmlFragment.doc,
          binding: null,
          snapshot: null,
          prevSnapshot: null,
          isChangeOrigin: false,
          colors,
          colorMapping,
          permanentUserData
        }
      },
      apply: (tr, pluginState) => {
        const change = tr.getMeta(ySyncPluginKey);
        if (change !== undefined) {
          pluginState = Object.assign({}, pluginState);
          for (const key in change) {
            pluginState[key] = change[key];
          }
        }
        // always set isChangeOrigin. If undefined, this is not change origin.
        pluginState.isChangeOrigin = change !== undefined && !!change.isChangeOrigin;
        if (pluginState.binding !== null) {
          if (change !== undefined && (change.snapshot != null || change.prevSnapshot != null)) {
            // snapshot changed, rerender next
            setTimeout(() => {
              if (change.restore == null) {
                pluginState.binding._renderSnapshot(change.snapshot, change.prevSnapshot, pluginState);
              } else {
                pluginState.binding._renderSnapshot(change.snapshot, change.snapshot, pluginState);
                // reset to current prosemirror state
                delete pluginState.restore;
                delete pluginState.snapshot;
                delete pluginState.prevSnapshot;
                pluginState.binding._prosemirrorChanged(pluginState.binding.prosemirrorView.state.doc);
              }
            }, 0);
          }
        }
        return pluginState
      }
    },
    view: view => {
      const binding = new ProsemirrorBinding(yXmlFragment, view);
      binding._forceRerender();
      return {
        update: () => {
          const pluginState = plugin.getState(view.state);
          if (pluginState.snapshot == null && pluginState.prevSnapshot == null) {
            changedInitialContent = changedInitialContent || initialContent 
              ? view.state.doc.content.findDiffStart(view.state.schema.nodeFromJSON(initialContent)) !== null 
              : view.state.doc.content.findDiffStart(view.state.doc.type.createAndFill().content)    !== null;
            if (changedInitialContent) {
              changedInitialContent = true;
              binding._prosemirrorChanged(view.state.doc);
            }
          }
        },
        destroy: () => {
          binding.destroy();
        }
      }
    }
  });
  return plugin
};

/**
 * @param {any} tr
 * @param {any} relSel
 * @param {ProsemirrorBinding} binding
 */
const restoreRelativeSelection = (tr, relSel, binding) => {
  if (relSel !== null && relSel.anchor !== null && relSel.head !== null) {
    const anchor = relativePositionToAbsolutePosition(binding.doc, binding.type, relSel.anchor, binding.mapping);
    const head = relativePositionToAbsolutePosition(binding.doc, binding.type, relSel.head, binding.mapping);
    if (anchor !== null && head !== null) {
      tr = tr.setSelection(prosemirrorState.TextSelection.create(tr.doc, anchor, head));
    }
  }
};

const getRelativeSelection = (pmbinding, state) => ({
  anchor: absolutePositionToRelativePosition(state.selection.anchor, pmbinding.type, pmbinding.mapping),
  head: absolutePositionToRelativePosition(state.selection.head, pmbinding.type, pmbinding.mapping)
});

/**
 * Binding for prosemirror.
 *
 * @protected
 */
class ProsemirrorBinding {
  /**
   * @param {Y.XmlFragment} yXmlFragment The bind source
   * @param {any} prosemirrorView The target binding
   */
  constructor (yXmlFragment, prosemirrorView) {
    this.type = yXmlFragment;
    this.prosemirrorView = prosemirrorView;
    this.mux = mutex_js.createMutex();
    /**
     * @type {ProsemirrorMapping}
     */
    this.mapping = new Map();
    this._observeFunction = this._typeChanged.bind(this);
    /**
     * @type {Y.Doc}
     */
    // @ts-ignore
    this.doc = yXmlFragment.doc;
    /**
     * current selection as relative positions in the Yjs model
     */
    this.beforeTransactionSelection = null;
    this.beforeAllTransactions = () => {
      if (this.beforeTransactionSelection === null) {
        this.beforeTransactionSelection = getRelativeSelection(this, prosemirrorView.state);
      }
    };
    this.afterAllTransactions = () => {
      this.beforeTransactionSelection = null;
    };

    this.doc.on('beforeAllTransactions', this.beforeAllTransactions);
    this.doc.on('afterAllTransactions', this.afterAllTransactions);
    yXmlFragment.observeDeep(this._observeFunction);

    this._domSelectionInView = null;
  }

  _isLocalCursorInView () {
    if (!this.prosemirrorView.hasFocus()) return false
    if (environment_js.isBrowser && this._domSelectionInView === null) {
      // Calculate the domSelectionInView and clear by next tick after all events are finished
      setTimeout(() => {
        this._domSelectionInView = null;
      }, 0);
      this._domSelectionInView = this._isDomSelectionInView();
    }
    return this._domSelectionInView
  }

  _isDomSelectionInView () {
    const selection = this.prosemirrorView._root.getSelection();

    const range = this.prosemirrorView._root.createRange();
    range.setStart(selection.anchorNode, selection.anchorOffset);
    range.setEnd(selection.focusNode, selection.focusOffset);

    // This is a workaround for an edgecase where getBoundingClientRect will
    // return zero values if the selection is collapsed at the start of a newline
    // see reference here: https://stackoverflow.com/a/59780954
    const rects = range.getClientRects();
    if (rects.length === 0) {
      // probably buggy newline behavior, explicitly select the node contents
      if (range.startContainer && range.collapsed) {
        range.selectNodeContents(range.startContainer);
      }
    }

    const bounding = range.getBoundingClientRect();
    const documentElement = dom_js.doc.documentElement;

    return bounding.bottom >= 0 && bounding.right >= 0 &&
      bounding.left <= (window.innerWidth || documentElement.clientWidth || 0) &&
      bounding.top <= (window.innerHeight || documentElement.clientHeight || 0)
  }

  renderSnapshot (snapshot, prevSnapshot) {
    if (!prevSnapshot) {
      prevSnapshot = Y.createSnapshot(Y.createDeleteSet(), new Map());
    }
    this.prosemirrorView.dispatch(this.prosemirrorView.state.tr.setMeta(ySyncPluginKey, { snapshot, prevSnapshot }));
  }

  unrenderSnapshot () {
    this.mapping = new Map();
    this.mux(() => {
      const fragmentContent = this.type.toArray().map(t => createNodeFromYElement(/** @type {Y.XmlElement} */ (t), this.prosemirrorView.state.schema, this.mapping)).filter(n => n !== null);
      // @ts-ignore
      const tr = this.prosemirrorView.state.tr.replace(0, this.prosemirrorView.state.doc.content.size, new prosemirrorModel.Slice(new prosemirrorModel.Fragment(fragmentContent), 0, 0));
      tr.setMeta(ySyncPluginKey, { snapshot: null, prevSnapshot: null });
      this.prosemirrorView.dispatch(tr);
    });
  }

  _forceRerender () {
    this.mapping = new Map();
    this.mux(() => {
      // const fragmentContent = this.type.toArray().map(t => createNodeFromYElement(/** @type {Y.XmlElement} */ (t), this.prosemirrorView.state.schema, this.mapping)).filter(n => n !== null)
      // @ts-ignore
      // const tr = this.prosemirrorView.state.tr.replace(0, this.prosemirrorView.state.doc.content.size, new PModel.Slice(new PModel.Fragment(fragmentContent), 0, 0))      const tr = this.prosemirrorView.state.tr
      const tr = this.prosemirrorView.state.tr;
      tr.setMeta(ySyncPluginKey, { binding: this });
      this.prosemirrorView.dispatch(tr);
    });
  }

  /**
   * @param {Y.Snapshot} snapshot
   * @param {Y.Snapshot} prevSnapshot
   * @param {Object} pluginState
   */
  _renderSnapshot (snapshot, prevSnapshot, pluginState) {
    if (!snapshot) {
      snapshot = Y.snapshot(this.doc);
    }
    // clear mapping because we are going to rerender
    this.mapping = new Map();
    this.mux(() => {
      this.doc.transact(transaction => {
        // before rendering, we are going to sanitize ops and split deleted ops
        // if they were deleted by seperate users.
        const pud = pluginState.permanentUserData;
        if (pud) {
          pud.dss.forEach(ds => {
            Y.iterateDeletedStructs(transaction, ds, item => {});
          });
        }
        const computeYChange = (type, id) => {
          const user = type === 'added' ? pud.getUserByClientId(id.client) : pud.getUserByDeletedId(id);
          return {
            user,
            type,
            color: getUserColor(pluginState.colorMapping, pluginState.colors, user)
          }
        };
        // Create document fragment and render
        const fragmentContent = Y.typeListToArraySnapshot(this.type, new Y.Snapshot(prevSnapshot.ds, snapshot.sv)).map(t => {
          if (!t._item.deleted || isVisible(t._item, snapshot) || isVisible(t._item, prevSnapshot)) {
            return createNodeFromYElement(t, this.prosemirrorView.state.schema, new Map(), snapshot, prevSnapshot, computeYChange)
          } else {
            // No need to render elements that are not visible by either snapshot.
            // If a client adds and deletes content in the same snapshot the element is not visible by either snapshot.
            return null
          }
        }).filter(n => n !== null);
        // @ts-ignore
        const tr = this.prosemirrorView.state.tr.replace(0, this.prosemirrorView.state.doc.content.size, new prosemirrorModel.Slice(new prosemirrorModel.Fragment(fragmentContent), 0, 0));
        this.prosemirrorView.dispatch(tr);
      }, ySyncPluginKey);
    });
  }

  /**
   * @param {Array<Y.YEvent>} events
   * @param {Y.Transaction} transaction
   */
  _typeChanged (events, transaction) {
    const syncState = ySyncPluginKey.getState(this.prosemirrorView.state);
    if (events.length === 0 || syncState.snapshot != null || syncState.prevSnapshot != null) {
      // drop out if snapshot is active
      this.renderSnapshot(syncState.snapshot, syncState.prevSnapshot);
      return
    }
    this.mux(() => {
      /**
       * @param {any} _
       * @param {Y.AbstractType} type
       */
      const delType = (_, type) => this.mapping.delete(type);
      Y.iterateDeletedStructs(transaction, transaction.deleteSet, struct => struct.constructor === Y.Item && this.mapping.delete(/** @type {Y.ContentType} */ (/** @type {Y.Item} */ (struct).content).type));
      transaction.changed.forEach(delType);
      transaction.changedParentTypes.forEach(delType);
      const fragmentContent = this.type.toArray().map(t => createNodeIfNotExists(/** @type {Y.XmlElement | Y.XmlHook} */ (t), this.prosemirrorView.state.schema, this.mapping)).filter(n => n !== null);
      // @ts-ignore
      let tr = this.prosemirrorView.state.tr.replaceWith(0, this.prosemirrorView.state.doc.content.size, new prosemirrorModel.Fragment(fragmentContent));
      restoreRelativeSelection(tr, this.beforeTransactionSelection, this);
      tr = tr.setMeta(ySyncPluginKey, { isChangeOrigin: true });
      if (this.beforeTransactionSelection !== null && this._isLocalCursorInView()) {
        tr.scrollIntoView();
      }
      this.prosemirrorView.dispatch(tr);
    });
  }

  _prosemirrorChanged (doc) {
    this.mux(() => {
      this.doc.transact(() => {
        updateYFragment(this.doc, this.type, doc, this.mapping);
        this.beforeTransactionSelection = getRelativeSelection(this, this.prosemirrorView.state);
      }, ySyncPluginKey);
    });
  }

  destroy () {
    this.type.unobserveDeep(this._observeFunction);
    this.doc.off('beforeAllTransactions', this.beforeAllTransactions);
    this.doc.off('afterAllTransactions', this.afterAllTransactions);
  }
}

/**
 * @private
 * @param {Y.XmlElement | Y.XmlHook} el
 * @param {PMSchema} schema
 * @param {ProsemirrorMapping} mapping
 * @param {Y.Snapshot} [snapshot]
 * @param {Y.Snapshot} [prevSnapshot]
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {PMNode | null}
 */
const createNodeIfNotExists = (el, schema, mapping, snapshot, prevSnapshot, computeYChange) => {
  const node = /** @type {PMNode} */ (mapping.get(el));
  if (node === undefined) {
    if (el instanceof Y.XmlElement) {
      return createNodeFromYElement(el, schema, mapping, snapshot, prevSnapshot, computeYChange)
    } else {
      throw error.methodUnimplemented() // we are currently not handling hooks
    }
  }
  return node
};

/**
 * @private
 * @param {Y.XmlElement} el
 * @param {any} schema
 * @param {ProsemirrorMapping} mapping
 * @param {Y.Snapshot} [snapshot]
 * @param {Y.Snapshot} [prevSnapshot]
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {PMNode | null} Returns node if node could be created. Otherwise it deletes the yjs type and returns null
 */
const createNodeFromYElement = (el, schema, mapping, snapshot, prevSnapshot, computeYChange) => {
  const children = [];
  const createChildren = type => {
    if (type.constructor === Y.XmlElement) {
      const n = createNodeIfNotExists(type, schema, mapping, snapshot, prevSnapshot, computeYChange);
      if (n !== null) {
        children.push(n);
      }
    } else {
      const ns = createTextNodesFromYText(type, schema, mapping, snapshot, prevSnapshot, computeYChange);
      if (ns !== null) {
        ns.forEach(textchild => {
          if (textchild !== null) {
            children.push(textchild);
          }
        });
      }
    }
  };
  if (snapshot === undefined || prevSnapshot === undefined) {
    el.toArray().forEach(createChildren);
  } else {
    Y.typeListToArraySnapshot(el, new Y.Snapshot(prevSnapshot.ds, snapshot.sv)).forEach(createChildren);
  }
  try {
    const attrs = el.getAttributes(snapshot);
    if (snapshot !== undefined) {
      if (!isVisible(/** @type {Y.Item} */ (el._item), snapshot)) {
        attrs.ychange = computeYChange ? computeYChange('removed', /** @type {Y.Item} */ (el._item).id) : { type: 'removed' };
      } else if (!isVisible(/** @type {Y.Item} */ (el._item), prevSnapshot)) {
        attrs.ychange = computeYChange ? computeYChange('added', /** @type {Y.Item} */ (el._item).id) : { type: 'added' };
      }
    }
    const node = schema.node(el.nodeName, attrs, children);
    mapping.set(el, node);
    return node
  } catch (e) {
    // an error occured while creating the node. This is probably a result of a concurrent action.
    /** @type {Y.Doc} */ (el.doc).transact(transaction => {
      /** @type {Y.Item} */ (el._item).delete(transaction);
    }, ySyncPluginKey);
    mapping.delete(el);
    return null
  }
};

/**
 * @private
 * @param {Y.XmlText} text
 * @param {any} schema
 * @param {ProsemirrorMapping} mapping
 * @param {Y.Snapshot} [snapshot]
 * @param {Y.Snapshot} [prevSnapshot]
 * @param {function('removed' | 'added', Y.ID):any} [computeYChange]
 * @return {Array<PMNode>|null}
 */
const createTextNodesFromYText = (text, schema, mapping, snapshot, prevSnapshot, computeYChange) => {
  const nodes = [];
  const deltas = text.toDelta(snapshot, prevSnapshot, computeYChange);
  try {
    for (let i = 0; i < deltas.length; i++) {
      const delta = deltas[i];
      const marks = [];
      for (const markName in delta.attributes) {
        marks.push(schema.mark(markName, delta.attributes[markName]));
      }
      nodes.push(schema.text(delta.insert, marks));
    }
  } catch (e) {
    // an error occured while creating the node. This is probably a result of a concurrent action.
    /** @type {Y.Doc} */ (text.doc).transact(transaction => {
      /** @type {Y.Item} */ (text._item).delete(transaction);
    }, ySyncPluginKey);
    return null
  }
  // @ts-ignore
  return nodes
};

/**
 * @private
 * @param {Array<any>} nodes prosemirror node
 * @param {ProsemirrorMapping} mapping
 * @return {Y.XmlText}
 */
const createTypeFromTextNodes = (nodes, mapping) => {
  const type = new Y.XmlText();
  const delta = nodes.map(node => ({
    // @ts-ignore
    insert: node.text,
    attributes: marksToAttributes(node.marks)
  }));
  type.applyDelta(delta);
  mapping.set(type, nodes);
  return type
};

/**
 * @private
 * @param {any} node prosemirror node
 * @param {ProsemirrorMapping} mapping
 * @return {Y.XmlElement}
 */
const createTypeFromElementNode = (node, mapping) => {
  const type = new Y.XmlElement(node.type.name);
  for (const key in node.attrs) {
    const val = node.attrs[key];
    if (val !== null && key !== 'ychange') {
      type.setAttribute(key, val);
    }
  }
  type.insert(0, normalizePNodeContent(node).map(n => createTypeFromTextOrElementNode(n, mapping)));
  mapping.set(type, node);
  return type
};

/**
 * @private
 * @param {PMNode|Array<PMNode>} node prosemirror text node
 * @param {ProsemirrorMapping} mapping
 * @return {Y.XmlElement|Y.XmlText}
 */
const createTypeFromTextOrElementNode = (node, mapping) => node instanceof Array ? createTypeFromTextNodes(node, mapping) : createTypeFromElementNode(node, mapping);

const equalAttrs = (pattrs, yattrs) => {
  const keys = Object.keys(pattrs).filter(key => pattrs[key] !== null);
  let eq = keys.length === Object.keys(yattrs).filter(key => yattrs[key] !== null).length;
  for (let i = 0; i < keys.length && eq; i++) {
    const key = keys[i];
    const l = pattrs[key];
    const r = yattrs[key];
    eq = key === 'ychange' || l === r || (typeof l === 'object' && typeof r === 'object' && equalAttrs(l, r));
  }
  return eq
};

/**
 * @typedef {Array<Array<PMNode>|PMNode>} NormalizedPNodeContent
 */

/**
 * @param {any} pnode
 * @return {NormalizedPNodeContent}
 */
const normalizePNodeContent = pnode => {
  const c = pnode.content.content;
  const res = [];
  for (let i = 0; i < c.length; i++) {
    const n = c[i];
    if (n.isText) {
      const textNodes = [];
      for (let tnode = c[i]; i < c.length && tnode.isText; tnode = c[++i]) {
        textNodes.push(tnode);
      }
      i--;
      res.push(textNodes);
    } else {
      res.push(n);
    }
  }
  return res
};

/**
 * @param {Y.XmlText} ytext
 * @param {Array<any>} ptexts
 */
const equalYTextPText = (ytext, ptexts) => {
  const delta = ytext.toDelta();
  return delta.length === ptexts.length && delta.every((d, i) => d.insert === /** @type {any} */ (ptexts[i]).text && object_js.keys(d.attributes || {}).length === ptexts[i].marks.length && ptexts[i].marks.every(mark => equalAttrs(d.attributes[mark.type.name] || {}, mark.attrs)))
};

/**
 * @param {Y.XmlElement|Y.XmlText|Y.XmlHook} ytype
 * @param {any|Array<any>} pnode
 */
const equalYTypePNode = (ytype, pnode) => {
  if (ytype instanceof Y.XmlElement && !(pnode instanceof Array) && matchNodeName(ytype, pnode)) {
    const normalizedContent = normalizePNodeContent(pnode);
    return ytype._length === normalizedContent.length && equalAttrs(ytype.getAttributes(), pnode.attrs) && ytype.toArray().every((ychild, i) => equalYTypePNode(ychild, normalizedContent[i]))
  }
  return ytype instanceof Y.XmlText && pnode instanceof Array && equalYTextPText(ytype, pnode)
};

/**
 * @param {PMNode | Array<PMNode> | undefined} mapped
 * @param {PMNode | Array<PMNode>} pcontent
 */
const mappedIdentity = (mapped, pcontent) => mapped === pcontent || (mapped instanceof Array && pcontent instanceof Array && mapped.length === pcontent.length && mapped.every((a, i) => pcontent[i] === a));

/**
 * @param {Y.XmlElement} ytype
 * @param {PMNode} pnode
 * @param {ProsemirrorMapping} mapping
 * @return {{ foundMappedChild: boolean, equalityFactor: number }}
 */
const computeChildEqualityFactor = (ytype, pnode, mapping) => {
  const yChildren = ytype.toArray();
  const pChildren = normalizePNodeContent(pnode);
  const pChildCnt = pChildren.length;
  const yChildCnt = yChildren.length;
  const minCnt = math.min(yChildCnt, pChildCnt);
  let left = 0;
  let right = 0;
  let foundMappedChild = false;
  for (; left < minCnt; left++) {
    const leftY = yChildren[left];
    const leftP = pChildren[left];
    if (mappedIdentity(mapping.get(leftY), leftP)) {
      foundMappedChild = true;// definite (good) match!
    } else if (!equalYTypePNode(leftY, leftP)) {
      break
    }
  }
  for (; left + right < minCnt; right++) {
    const rightY = yChildren[yChildCnt - right - 1];
    const rightP = pChildren[pChildCnt - right - 1];
    if (mappedIdentity(mapping.get(rightY), rightP)) {
      foundMappedChild = true;
    } else if (!equalYTypePNode(rightY, rightP)) {
      break
    }
  }
  return {
    equalityFactor: left + right,
    foundMappedChild
  }
};

const ytextTrans = ytext => {
  let str = '';
  /**
   * @type {Y.Item|null}
   */
  let n = ytext._start;
  const nAttrs = {};
  while (n !== null) {
    if (!n.deleted) {
      if (n.countable && n.content instanceof Y.ContentString) {
        str += n.content.str;
      } else if (n.content instanceof Y.ContentFormat) {
        nAttrs[n.content.key] = null;
      }
    }
    n = n.right;
  }
  return {
    str,
    nAttrs
  }
};

/**
 * @todo test this more
 *
 * @param {Y.Text} ytext
 * @param {Array<any>} ptexts
 * @param {ProsemirrorMapping} mapping
 */
const updateYText = (ytext, ptexts, mapping) => {
  mapping.set(ytext, ptexts);
  const { nAttrs, str } = ytextTrans(ytext);
  const content = ptexts.map(p => ({ insert: /** @type {any} */ (p).text, attributes: Object.assign({}, nAttrs, marksToAttributes(p.marks)) }));
  const { insert, remove, index } = diff_js.simpleDiff(str, content.map(c => c.insert).join(''));
  ytext.delete(index, remove);
  ytext.insert(index, insert);
  ytext.applyDelta(content.map(c => ({ retain: c.insert.length, attributes: c.attributes })));
};

const marksToAttributes = marks => {
  const pattrs = {};
  marks.forEach(mark => {
    if (mark.type.name !== 'ychange') {
      pattrs[mark.type.name] = mark.attrs;
    }
  });
  return pattrs
};

/**
 * @private
 * @param {Y.Doc} y
 * @param {Y.XmlFragment} yDomFragment
 * @param {any} pNode
 * @param {ProsemirrorMapping} mapping
 */
const updateYFragment = (y, yDomFragment, pNode, mapping) => {
  if (yDomFragment instanceof Y.XmlElement && yDomFragment.nodeName !== pNode.type.name) {
    throw new Error('node name mismatch!')
  }
  mapping.set(yDomFragment, pNode);
  // update attributes
  if (yDomFragment instanceof Y.XmlElement) {
    const yDomAttrs = yDomFragment.getAttributes();
    const pAttrs = pNode.attrs;
    for (const key in pAttrs) {
      if (pAttrs[key] !== null) {
        if (yDomAttrs[key] !== pAttrs[key] && key !== 'ychange') {
          yDomFragment.setAttribute(key, pAttrs[key]);
        }
      } else {
        yDomFragment.removeAttribute(key);
      }
    }
    // remove all keys that are no longer in pAttrs
    for (const key in yDomAttrs) {
      if (pAttrs[key] === undefined) {
        yDomFragment.removeAttribute(key);
      }
    }
  }
  // update children
  const pChildren = normalizePNodeContent(pNode);
  const pChildCnt = pChildren.length;
  const yChildren = yDomFragment.toArray();
  const yChildCnt = yChildren.length;
  const minCnt = math.min(pChildCnt, yChildCnt);
  let left = 0;
  let right = 0;
  // find number of matching elements from left
  for (;left < minCnt; left++) {
    const leftY = yChildren[left];
    const leftP = pChildren[left];
    if (!mappedIdentity(mapping.get(leftY), leftP)) {
      if (equalYTypePNode(leftY, leftP)) {
        // update mapping
        mapping.set(leftY, leftP);
      } else {
        break
      }
    }
  }
  // find number of matching elements from right
  for (;right + left + 1 < minCnt; right++) {
    const rightY = yChildren[yChildCnt - right - 1];
    const rightP = pChildren[pChildCnt - right - 1];
    if (!mappedIdentity(mapping.get(rightY), rightP)) {
      if (equalYTypePNode(rightY, rightP)) {
        // update mapping
        mapping.set(rightY, rightP);
      } else {
        break
      }
    }
  }
  y.transact(() => {
    // try to compare and update
    while (yChildCnt - left - right > 0 && pChildCnt - left - right > 0) {
      const leftY = yChildren[left];
      const leftP = pChildren[left];
      const rightY = yChildren[yChildCnt - right - 1];
      const rightP = pChildren[pChildCnt - right - 1];
      if (leftY instanceof Y.XmlText && leftP instanceof Array) {
        if (!equalYTextPText(leftY, leftP)) {
          updateYText(leftY, leftP, mapping);
        }
        left += 1;
      } else {
        let updateLeft = leftY instanceof Y.XmlElement && matchNodeName(leftY, leftP);
        let updateRight = rightY instanceof Y.XmlElement && matchNodeName(rightY, rightP);
        if (updateLeft && updateRight) {
          // decide which which element to update
          const equalityLeft = computeChildEqualityFactor(/** @type {Y.XmlElement} */ (leftY), /** @type {PMNode} */ (leftP), mapping);
          const equalityRight = computeChildEqualityFactor(/** @type {Y.XmlElement} */ (rightY), /** @type {PMNode} */ (rightP), mapping);
          if (equalityLeft.foundMappedChild && !equalityRight.foundMappedChild) {
            updateRight = false;
          } else if (!equalityLeft.foundMappedChild && equalityRight.foundMappedChild) {
            updateLeft = false;
          } else if (equalityLeft.equalityFactor < equalityRight.equalityFactor) {
            updateLeft = false;
          } else {
            updateRight = false;
          }
        }
        if (updateLeft) {
          updateYFragment(y, /** @type {Y.XmlFragment} */ (leftY), /** @type {PMNode} */ (leftP), mapping);
          left += 1;
        } else if (updateRight) {
          updateYFragment(y, /** @type {Y.XmlFragment} */ (rightY), /** @type {PMNode} */ (rightP), mapping);
          right += 1;
        } else {
          yDomFragment.delete(left, 1);
          yDomFragment.insert(left, [createTypeFromTextOrElementNode(leftP, mapping)]);
          left += 1;
        }
      }
    }
    const yDelLen = yChildCnt - left - right;
    if (yDelLen > 0) {
      yDomFragment.delete(left, yDelLen);
    }
    if (left + right < pChildCnt) {
      const ins = [];
      for (let i = left; i < pChildCnt - right; i++) {
        ins.push(createTypeFromTextOrElementNode(pChildren[i], mapping));
      }
      yDomFragment.insert(left, ins);
    }
  }, ySyncPluginKey);
};

/**
 * @function
 * @param {Y.XmlElement} yElement
 * @param {any} pNode Prosemirror Node
 */
const matchNodeName = (yElement, pNode) => !(pNode instanceof Array) && yElement.nodeName === pNode.type.name;

/**
 * Either a node if type is YXmlElement or an Array of text nodes if YXmlText
 * @typedef {Map<Y.AbstractType, Node | Array<Node>>} ProsemirrorMapping
 */

/**
 * Is null if no timeout is in progress.
 * Is defined if a timeout is in progress.
 * Maps from view
 * @type {Map<EditorView, Map<any, any>>|null}
 */
let viewsToUpdate = null;

const updateMetas = () => {
  const ups = /** @type {Map<EditorView, Map<any, any>>} */ (viewsToUpdate);
  viewsToUpdate = null;
  ups.forEach((metas, view) => {
    const tr = view.state.tr;
    metas.forEach((val, key) => {
      tr.setMeta(key, val);
    });
    view.dispatch(tr);
  });
};

const setMeta = (view, key, value) => {
  if (!viewsToUpdate) {
    viewsToUpdate = new Map();
    eventloop.timeout(0, updateMetas);
  }
  map.setIfUndefined(viewsToUpdate, view, map.create).set(key, value);
};

/**
 * Transforms a Prosemirror based absolute position to a Yjs Cursor (relative position in the Yjs model).
 *
 * @param {number} pos
 * @param {Y.XmlFragment} type
 * @param {ProsemirrorMapping} mapping
 * @return {any} relative position
 */
const absolutePositionToRelativePosition = (pos, type, mapping) => {
  if (pos === 0) {
    return Y.createRelativePositionFromTypeIndex(type, 0)
  }
  let n = type._first === null ? null : /** @type {Y.ContentType} */ (type._first.content).type;
  while (n !== null && type !== n) {
    if (n.constructor === Y.XmlText) {
      if (n._length >= pos) {
        return Y.createRelativePositionFromTypeIndex(n, pos)
      } else {
        pos -= n._length;
      }
      if (n._item !== null && n._item.next !== null) {
        n = /** @type {Y.ContentType} */ (n._item.next.content).type;
      } else {
        do {
          n = n._item === null ? null : n._item.parent;
          pos--;
        } while (n !== type && n !== null && n._item !== null && n._item.next === null)
        if (n !== null && n !== type) {
          // @ts-gnore we know that n.next !== null because of above loop conditition
          n = n._item === null ? null : /** @type {Y.ContentType} */ (/** @type Y.Item */ (n._item.next).content).type;
        }
      }
    } else {
      const pNodeSize = /** @type {any} */ (mapping.get(n) || { nodeSize: 0 }).nodeSize;
      if (n._first !== null && pos < pNodeSize) {
        n = /** @type {Y.ContentType} */ (n._first.content).type;
        pos--;
      } else {
        if (pos === 1 && n._length === 0 && pNodeSize > 1) {
          // edge case, should end in this paragraph
          return new Y.RelativePosition(n._item === null ? null : n._item.id, n._item === null ? Y.findRootTypeKey(n) : null, null)
        }
        pos -= pNodeSize;
        if (n._item !== null && n._item.next !== null) {
          n = /** @type {Y.ContentType} */ (n._item.next.content).type;
        } else {
          if (pos === 0) {
            // set to end of n.parent
            n = n._item === null ? n : n._item.parent;
            return new Y.RelativePosition(n._item === null ? null : n._item.id, n._item === null ? Y.findRootTypeKey(n) : null, null)
          }
          do {
            n = /** @type {Y.Item} */ (n._item).parent;
            pos--;
          } while (n !== type && /** @type {Y.Item} */ (n._item).next === null)
          // if n is null at this point, we have an unexpected case
          if (n !== type) {
            // We know that n._item.next is defined because of above loop condition
            n = /** @type {Y.ContentType} */ (/** @type {Y.Item} */ (/** @type {Y.Item} */ (n._item).next).content).type;
          }
        }
      }
    }
    if (n === null) {
      throw error.unexpectedCase()
    }
    if (pos === 0 && n.constructor !== Y.XmlText && n !== type) { // TODO: set to <= 0
      return createRelativePosition(n._item.parent, n._item)
    }
  }
  return Y.createRelativePositionFromTypeIndex(type, type._length)
};

const createRelativePosition = (type, item) => {
  let typeid = null;
  let tname = null;
  if (type._item === null) {
    tname = Y.findRootTypeKey(type);
  } else {
    typeid = Y.createID(type._item.id.client, type._item.id.clock);
  }
  return new Y.RelativePosition(typeid, tname, item.id)
};

/**
 * @param {Y.Doc} y
 * @param {Y.XmlFragment} documentType Top level type that is bound to pView
 * @param {any} relPos Encoded Yjs based relative position
 * @param {ProsemirrorMapping} mapping
 * @return {null|number}
 */
const relativePositionToAbsolutePosition = (y, documentType, relPos, mapping) => {
  const decodedPos = Y.createAbsolutePositionFromRelativePosition(relPos, y);
  if (decodedPos === null || (decodedPos.type !== documentType && !Y.isParentOf(documentType, decodedPos.type._item))) {
    return null
  }
  let type = decodedPos.type;
  let pos = 0;
  if (type.constructor === Y.XmlText) {
    pos = decodedPos.index;
  } else if (type._item === null || !type._item.deleted) {
    let n = type._first;
    let i = 0;
    while (i < type._length && i < decodedPos.index && n !== null) {
      if (!n.deleted) {
        const t = /** @type {Y.ContentType} */ (n.content).type;
        i++;
        if (t.constructor === Y.XmlText) {
          pos += t._length;
        } else {
          pos += /** @type {any} */ (mapping.get(t)).nodeSize;
        }
      }
      n = /** @type {Y.Item} */ (n.right);
    }
    pos += 1; // increase because we go out of n
  }
  while (type !== documentType && type._item !== null) {
    // @ts-ignore
    const parent = type._item.parent;
    // @ts-ignore
    if (parent._item === null || !parent._item.deleted) {
      pos += 1; // the start tag
      let n = parent._first;
      // now iterate until we found type
      while (n !== null) {
        const contentType = /** @type {Y.ContentType} */ (n.content).type;
        if (contentType === type) {
          break
        }
        if (!n.deleted) {
          if (contentType.constructor === Y.XmlText) {
            pos += contentType._length;
          } else {
            pos += /** @type {any} */ (mapping.get(contentType)).nodeSize;
          }
        }
        n = n.right;
      }
    }
    type = parent;
  }
  return pos - 1 // we don't count the most outer tag, because it is a fragment
};

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
function prosemirrorToYDoc (doc, xmlFragment = 'prosemirror') {
  const ydoc = new Y.Doc();
  const type = ydoc.get(xmlFragment, Y.XmlFragment);
  if (!type.doc) {
    return ydoc
  }

  updateYFragment(type.doc, type, doc, new Map());
  return type.doc
}

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
function prosemirrorJSONToYDoc (schema, state, xmlFragment = 'prosemirror') {
  const doc = prosemirrorModel.Node.fromJSON(schema, state);
  return prosemirrorToYDoc(doc, xmlFragment)
}

/**
 * Utility method to convert a Y.Doc to a Prosemirror Doc node.
 *
 * @param {Schema} schema
 * @param {Y.Doc} ydoc
 * @return {Node}
 */
function yDocToProsemirror (schema, ydoc) {
  const state = yDocToProsemirrorJSON(ydoc);
  return prosemirrorModel.Node.fromJSON(schema, state)
}

/**
 * Utility method to convert a Y.Doc to Prosemirror compatible JSON.
 *
 * @param {Y.Doc} ydoc
 * @param {string} xmlFragment
 * @return {Record<string, any>}
 */
function yDocToProsemirrorJSON (
  ydoc,
  xmlFragment = 'prosemirror'
) {
  const items = ydoc.getXmlFragment(xmlFragment).toArray();

  function serialize (item) {
    /**
     * @type {Object} NodeObject
     * @property {string} NodeObject.type
     * @property {Record<string, string>=} NodeObject.attrs
     * @property {Array<NodeObject>=} NodeObject.content
     */
    let response;

    // TODO: Must be a better way to detect text nodes than this
    if (!item.nodeName) {
      const delta = item.toDelta();
      response = delta.map((d) => {
        const text = {
          type: 'text',
          text: d.insert
        };

        if (d.attributes) {
          text.marks = Object.keys(d.attributes).map((type) => {
            const attrs = d.attributes[type];
            const mark = {
              type
            };

            if (Object.keys(attrs)) {
              mark.attrs = attrs;
            }

            return mark
          });
        }
        return text
      });
    } else {
      response = {
        type: item.nodeName
      };

      const attrs = item.getAttributes();
      if (Object.keys(attrs).length) {
        response.attrs = attrs;
      }

      const children = item.toArray();
      if (children.length) {
        response.content = children.map(serialize).flat();
      }
    }

    return response
  }

  return {
    type: 'doc',
    content: items.map(serialize)
  }
}

/**
 * Default generator for a cursor element
 *
 * @param {any} user user data
 * @return HTMLElement
 */
const defaultCursorBuilder = user => {
  const cursor = document.createElement('span');
  cursor.classList.add('ProseMirror-yjs-cursor');
  cursor.setAttribute('style', `border-color: ${user.color}`);
  const userDiv = document.createElement('div');
  userDiv.setAttribute('style', `background-color: ${user.color}`);
  userDiv.insertBefore(document.createTextNode(user.name), null);
  cursor.insertBefore(userDiv, null);
  return cursor
};

/**
 * @param {any} state
 * @param {Awareness} awareness
 * @return {any} DecorationSet
 */
const createDecorations = (state, awareness, createCursor) => {
  const ystate = ySyncPluginKey.getState(state);
  const y = ystate.doc;
  const decorations = [];
  if (ystate.snapshot != null || ystate.prevSnapshot != null || ystate.binding === null) {
    // do not render cursors while snapshot is active
    return prosemirrorView.DecorationSet.create(state.doc, [])
  }
  awareness.getStates().forEach((aw, clientId) => {
    if (clientId === y.clientID) {
      return
    }
    if (aw.cursor != null) {
      const user = aw.user || {};
      if (user.color == null) {
        user.color = '#ffa500';
      }
      if (user.name == null) {
        user.name = `User: ${clientId}`;
      }
      let anchor = relativePositionToAbsolutePosition(y, ystate.type, Y.createRelativePositionFromJSON(aw.cursor.anchor), ystate.binding.mapping);
      let head = relativePositionToAbsolutePosition(y, ystate.type, Y.createRelativePositionFromJSON(aw.cursor.head), ystate.binding.mapping);
      if (anchor !== null && head !== null) {
        const maxsize = math.max(state.doc.content.size - 1, 0);
        anchor = math.min(anchor, maxsize);
        head = math.min(head, maxsize);
        decorations.push(prosemirrorView.Decoration.widget(head, () => createCursor(user), { key: clientId + '', side: 10 }));
        const from = math.min(anchor, head);
        const to = math.max(anchor, head);
        decorations.push(prosemirrorView.Decoration.inline(from, to, { style: `background-color: ${user.color}70` }, { inclusiveEnd: true, inclusiveStart: false }));
      }
    }
  });
  return prosemirrorView.DecorationSet.create(state.doc, decorations)
};

/**
 * A prosemirror plugin that listens to awareness information on Yjs.
 * This requires that a `prosemirrorPlugin` is also bound to the prosemirror.
 *
 * @public
 * @param {Awareness} awareness
 * @param {object} [opts]
 * @param {function(any):HTMLElement} [opts.cursorBuilder]
 * @param {function(any):any} [opts.getSelection]
 * @param {string} [opts.cursorStateField] By default all editor bindings use the awareness 'cursor' field to propagate cursor information.
 * @return {any}
 */
const yCursorPlugin = (awareness, { cursorBuilder = defaultCursorBuilder, getSelection = state => state.selection } = {}, cursorStateField = 'cursor') => new prosemirrorState.Plugin({
  key: yCursorPluginKey,
  state: {
    init (_, state) {
      return createDecorations(state, awareness, cursorBuilder)
    },
    apply (tr, prevState, oldState, newState) {
      const ystate = ySyncPluginKey.getState(newState);
      const yCursorState = tr.getMeta(yCursorPluginKey);
      if ((ystate && ystate.isChangeOrigin) || (yCursorState && yCursorState.awarenessUpdated)) {
        return createDecorations(newState, awareness, cursorBuilder)
      }
      return prevState.map(tr.mapping, tr.doc)
    }
  },
  props: {
    decorations: state => {
      return yCursorPluginKey.getState(state)
    }
  },
  view: view => {
    const awarenessListener = () => {
      // @ts-ignore
      if (view.docView) {
        setMeta(view, yCursorPluginKey, { awarenessUpdated: true });
      }
    };
    const updateCursorInfo = () => {
      const ystate = ySyncPluginKey.getState(view.state);
      // @note We make implicit checks when checking for the cursor property
      const current = awareness.getLocalState() || {};
      if (view.hasFocus() && ystate.binding !== null) {
        const selection = getSelection(view.state);
        /**
         * @type {Y.RelativePosition}
         */
        const anchor = absolutePositionToRelativePosition(selection.anchor, ystate.type, ystate.binding.mapping);
        /**
         * @type {Y.RelativePosition}
         */
        const head = absolutePositionToRelativePosition(selection.head, ystate.type, ystate.binding.mapping);
        if (current.cursor == null || !Y.compareRelativePositions(Y.createRelativePositionFromJSON(current.cursor.anchor), anchor) || !Y.compareRelativePositions(Y.createRelativePositionFromJSON(current.cursor.head), head)) {
          awareness.setLocalStateField(cursorStateField, {
            anchor, head
          });
        }
      } else if (current.cursor != null && relativePositionToAbsolutePosition(ystate.doc, ystate.type, Y.createRelativePositionFromJSON(current.cursor.anchor), ystate.binding.mapping) !== null) {
        // delete cursor information if current cursor information is owned by this editor binding
        awareness.setLocalStateField(cursorStateField, null);
      }
    };
    awareness.on('change', awarenessListener);
    view.dom.addEventListener('focusin', updateCursorInfo);
    view.dom.addEventListener('focusout', updateCursorInfo);
    return {
      update: updateCursorInfo,
      destroy: () => {
        view.dom.removeEventListener('focusin', updateCursorInfo);
        view.dom.removeEventListener('focusout', updateCursorInfo);
        awareness.off('change', awarenessListener);
        awareness.setLocalStateField(cursorStateField, null);
      }
    }
  }
});

const undo = state => {
  const undoManager = yUndoPluginKey.getState(state).undoManager;
  if (undoManager != null) {
    undoManager.undo();
    return true
  }
};

const redo = state => {
  const undoManager = yUndoPluginKey.getState(state).undoManager;
  if (undoManager != null) {
    undoManager.redo();
    return true
  }
};

const yUndoPlugin = ({ protectedNodes = new Set(['paragraph']), trackedOrigins = [] } = {}) => new prosemirrorState.Plugin({
  key: yUndoPluginKey,
  state: {
    init: (initargs, state) => {
      // TODO: check if plugin order matches and fix
      const ystate = ySyncPluginKey.getState(state);
      const undoManager = new Y.UndoManager(ystate.type, {
        trackedOrigins: new Set([ySyncPluginKey].concat(trackedOrigins)),
        deleteFilter: item => !(item instanceof Y.Item) ||
          !(item.content instanceof Y.ContentType) ||
          !(item.content.type instanceof Y.Text ||
            (item.content.type instanceof Y.XmlElement && protectedNodes.has(item.content.type.nodeName))) ||
          item.content.type._length === 0
      });
      return {
        undoManager,
        prevSel: null,
        hasUndoOps: undoManager.undoStack.length > 0,
        hasRedoOps: undoManager.redoStack.length > 0
      }
    },
    apply: (tr, val, oldState, state) => {
      const binding = ySyncPluginKey.getState(state).binding;
      const undoManager = val.undoManager;
      const hasUndoOps = undoManager.undoStack.length > 0;
      const hasRedoOps = undoManager.redoStack.length > 0;
      if (binding) {
        return {
          undoManager,
          prevSel: getRelativeSelection(binding, oldState),
          hasUndoOps,
          hasRedoOps
        }
      } else {
        if (hasUndoOps !== val.hasUndoOps || hasRedoOps !== val.hasRedoOps) {
          return Object.assign({}, val, {
            hasUndoOps: undoManager.undoStack.length > 0,
            hasRedoOps: undoManager.redoStack.length > 0
          })
        } else { // nothing changed
          return val
        }
      }
    }
  },
  view: view => {
    const ystate = ySyncPluginKey.getState(view.state);
    const undoManager = yUndoPluginKey.getState(view.state).undoManager;
    undoManager.on('stack-item-added', ({ stackItem }) => {
      const binding = ystate.binding;
      if (binding) {
        stackItem.meta.set(binding, yUndoPluginKey.getState(view.state).prevSel);
      }
    });
    undoManager.on('stack-item-popped', ({ stackItem }) => {
      const binding = ystate.binding;
      if (binding) {
        binding.beforeTransactionSelection = stackItem.meta.get(binding) || binding.beforeTransactionSelection;
      }
    });
    return {
      destroy: () => {
        undoManager.destroy();
      }
    }
  }
});

exports.ProsemirrorBinding = ProsemirrorBinding;
exports.absolutePositionToRelativePosition = absolutePositionToRelativePosition;
exports.createDecorations = createDecorations;
exports.defaultCursorBuilder = defaultCursorBuilder;
exports.getRelativeSelection = getRelativeSelection;
exports.isVisible = isVisible;
exports.prosemirrorJSONToYDoc = prosemirrorJSONToYDoc;
exports.prosemirrorToYDoc = prosemirrorToYDoc;
exports.redo = redo;
exports.relativePositionToAbsolutePosition = relativePositionToAbsolutePosition;
exports.setMeta = setMeta;
exports.undo = undo;
exports.yCursorPlugin = yCursorPlugin;
exports.yCursorPluginKey = yCursorPluginKey;
exports.yDocToProsemirror = yDocToProsemirror;
exports.yDocToProsemirrorJSON = yDocToProsemirrorJSON;
exports.ySyncPlugin = ySyncPlugin;
exports.ySyncPluginKey = ySyncPluginKey;
exports.yUndoPlugin = yUndoPlugin;
exports.yUndoPluginKey = yUndoPluginKey;
//# sourceMappingURL=y-prosemirror.cjs.map