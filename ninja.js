/*global window, $, nunjucks, skateDomDiff*/

(function (factory) {
    window.Ninja = factory();
}(function () {
    var Ninja = {
        // Deep merge helper
        merge: (function () {
            if (window.jQuery) {
                return function merge () {
                    var args = [true].concat(Array.from(arguments));
                    return window.jQuery.extend.apply(window.jQuery, args);
                };
            } else { // for mobile
                return function merge (out) {
                    out = out || {};
                    for (var i = 1; i < arguments.length; i += 1) {
                        var obj = arguments[i];
                        if (!obj) {
                            continue;
                        }
                        for (var key in obj) {
                            if (obj.hasOwnProperty(key)) {
                                if (typeof obj[key] === 'object')
                                    out[key] = Ninja.merge(out[key], obj[key]);
                                else
                                    out[key] = obj[key];
                            }
                        }
                    }
                    return out;
                };
            }
        }()),

        /**
         * Generates an unique alpha-numeric identifier.<br/>
         * To get the same permutation as RFC-4122 use len=24.
         * @param [len=10] Length of the UUID.
         * @param [hypenate=false] When set to true, hyphens are added to the UUID.
         * @return {String} The UUID
         * @method uuid
         */
        uuid: function (len, hypenate) {
            var count = 1, id = ('x').repeat(len || 10).replace(/x/g, function () {
                return ((count++ % 5) ? '' : '-') + (Math.random() * 100 % 36 | 0).toString(36);
            });
            return hypenate ? id : id.replace(/-/g, '');
        },

        /**
         * Send in any object (including function, DOM Nodes or whatever) and get a unique id.
         * If you send the object again, the same id will be returned as the last time.
         * This does not leak memory.
         * @method getUID
         */
        getUID: function getUID(obj) {
            if (!obj._uid_) {
                Object.defineProperty(obj, '_uid_', {
                    value: Ninja.uuid(),
                    enumerable: false
                });
            }
            return obj._uid_;
        },

        /*Dom helpers*/
        /**
         * Converts html string to a document fragment.
         * @param {String} html
         * @return {DocumentFragment}
         * @method dom
         */
        dom: (function () {
            if (window.jQuery) {
                return function dom(html) {
                    var frag = document.createDocumentFragment();
                    window.jQuery.parseHTML(html).forEach(function (node) {
                        frag.appendChild(node);
                    });
                    return frag;
                };
            } else { // for mobile
                return function dom(html) {
                    var templateTag = document.createElement('template');
                    templateTag.innerHTML = html;
                    return templateTag.content.cloneNode(true);
                };
            }
        }()),

        /**
         * Helper to attach event listener to DOM. Uses jQuery if available or falls back to custom implemeentation.
         * @param {String} html
         * @return {DocumentFragment}
         * @method dom
         */
        on: (function () {
            if (window.jQuery) {
                return function on(node, eventName, func, context) {
                    $(node).on(eventName, func.bind(context));
                };
            } else { // for mobile
                return function on(node, eventName, func, context) {
                    node._bindings = node._bindings || {};
                    var key = eventName + '#' + Ninja.getUID(func);
                    if (context) { // prevent multiple events from being added.
                        key += '#' + Ninja.getUID(context);
                    }
                    if (!node._bindings[key]) {
                        node._bindings[key] = context ? func.bind(context) : func;
                    }
                    func = node._bindings[key];
                    node.addEventListener(eventName, func);
                };
            }
        }()),

        removeAllEventListeners: (function () {
            if (window.jQuery) {
                return function removeAllEventListeners(node) {
                    $(node).off();
                };
            } else { // for mobile
                return function removeAllEventListeners(node) {
                    if (node._bindings) {
                        Object.keys(node._bindings).forEach(function (key) {
                            var eventName = key.split('#')[0];
                            var func = node._bindings[key];
                            node.removeEventListener(eventName, func);
                        });
                        delete node._bindings;
                    }
                };
            }
        }())
    };

    Ninja.View = function (config) {
        this.id = Ninja.View.generateUId();
        this._data = {};
        this.setConfig(config);

        var data = this.data;
        delete this.data;
        Object.defineProperty(this, 'data', {
            configurable: false,
            set: function (data) {
                data.$view = this;
                this._data = data;
                this.render();
            },
            get: function () {
                return this._data;
            }
        });
        //Trigger render.
        if (data) {
            this.data = data;
        }
    };

    /**
     * Compiles the given template using detected template engine.
     * 
     * If compiler isn't available, assume 'template' is an id to an already compiled
     * template (stored within some namespace) and return 'template' as is.
     */
    Ninja.View.compile = function (template) {
        if (window.nunjucks || window.swig) {
            return template;
        } else if (window.doT) {
            return window.doT.template(template);
        }
    };

    // Methods and properties
    Object.assign(Ninja.View.prototype, {
        /**
         * The data object.
         * This is a private variable accessed through this.data
         * setter/getter.
         */
        _data: null,

        /**
         * The name of the preconmpiled nunjucks template to use.
         */
        template: null,

        /**
         * (Optional) The elment to replace (on first render).
         */
        target: null,

        /**
         * Sets config.
         */
        setConfig: function (config) {
            if (config && typeof config.template === 'string') {
                config.template = Ninja.View.compile(config.template);
            }
            Object.assign(this, config);
        },

        /**
         * Set data on this.data (using Object.assign), and re-render.
         */
        assign: function (data) {
            Object.assign(this.data, data);
            this.render();
        },

        /**
         * Deep merge data with this.data, and re-render.
         */
        merge: function (data) {
            Ninja.merge(this.data, data);
            this.render();
        },

        getHTML: function () {
            if (window.nunjucks) {
                return window.nunjucks.render(this.template, this.data);
            } else if (window.swig) {
                return window.swig.run(window.swig._precompiled[this.template], this.data, this.template);
            } else { // assume this.template is a compiled template function that takes data
                return this.template(this.data);
            }
        },

        /**
         * Render view.
         * If this.target or node paramter is specified, then replaces that node and attaches the
         * rendered DOM to document (or document fragment). Else the render is in-memory.
         *
         * @param {Node} [node] The node to replace. If not sepcified, then searches
         * for the selector specified at this.target.
         *
         * @private
         */
        render: function () {
            // Step 1: Remove event listeners
            // Step 2: Note the currently focused element
            // Step 3: Render/Update UI.
            // Step 4: Resolve references
            // Step 5: Re-focus
            // Step 6: Re-attach listeners

            var target = this.el;

            // Step 1: Find input field focus, remember it's id attribute, so that it
            // can be refocused later.
            var focusId = document.activeElement.id;

            // Step 2: Remove event listeners before patch.
            if (target) {
                [target].concat(Array.from(target.querySelectorAll('*')))
                    .forEach(function (node) {
                        if (node.nodeType === 1) {
                            Ninja.removeAllEventListeners(node);
                        }
                    }, this);
            }

            // Step 3: Render/Update UI
            var view = Ninja.dom(this.getHTML()),
                el = view.firstElementChild;

            // Update existing DOM.
            if (target) {
                var parent = target.parentNode,
                    childIndex = Array.from(parent.childNodes).indexOf(target);

                //Update UI (using DOM diff & patch).
                window.domPatch(el, target);
                this.el = parent.childNodes[childIndex];
            } else {
                this.el = el;
            }

            this.el.ninjaView = this;

            // Step 4. Resolve element ref and refs.
            // Note:
            // ref creates a reference to the node as property on the view.
            // refs creates an array property on the view, into which the node is pushed.
            Array.from(this.el.querySelectorAll('[ref]')).forEach(function (node) {
                this[node.getAttribute('ref')] = node;
            }, this);

            var refs = Array.from(this.el.querySelectorAll('[refs]'));
            //Empty references first.
            refs.forEach(function (node) {
                this[node.getAttribute('ref')] = [];
            }, this);
            //Create reference.
            refs.forEach(function (node) {
                this[node.getAttribute('ref')].push(node);
            }, this);

            // Step 5: Re-focus
            if (focusId) {
                var focusEl = document.getElementById(focusId);
                if (focusEl) {
                    focusEl.focus();
                }
            }

            // Step 6: Attach event listeners.
            [this.el].concat(Array.from(this.el.querySelectorAll('*')))
                .forEach(function (node) {
                    if (node.nodeType === 1) {
                        Array.from(node.attributes).forEach(function (attr) {
                            if (attr.name.startsWith('on-')) {
                                var eventName = attr.name.replace(/on-/, '');
                                Ninja.on(node, eventName, this[attr.value], this);
                            }
                        }, this);
                    }
                }, this);
        },

        mount: function (node) {
            if (!this.el) {
                return this.render(node);
            }

            if (!node && this.target) {
                if (typeof this.target === 'string') {
                    node = document.querySelector(this.target);
                } else if (this.target instanceof HTMLElement) {
                    node = this.target;
                }
            }

            //Return if already mounted.
            if (this.el && node === this.el) {
                return;
            }

            if (node && node.parentNode) {
                var parent = node.parentNode,
                    childIndex = Array.from(parent.childNodes).indexOf(node);

                //Update UI (using DOM diff & patch).
                skateDomDiff.merge({
                    target: node,
                    destination: this.el
                });
                this.el = parent.childNodes[childIndex];
                this.el.ninjaView = this;
            }
        },
        
        append: function (node) {
            if (!this.el) {
                return this.render();
            }
            node.appendChild(this.el);
        }
    });

    // Static methods and properties
    Object.assign(Ninja.View, {
        uid: 1,
        generateUId: function () {
            var id = 'view-' + Ninja.View.uid;
            Ninja.View.uid += 1;
            return id;
        }
    });

    return Ninja;
}));
