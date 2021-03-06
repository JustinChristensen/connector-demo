(function () {
    const config = {
        placeholder: 'Stuff and things',
        storageKey: 'data',
        scrollRange: 800
    };

    const ready = () => new Promise(resolve => {
        if (document.readyState !== 'loading') return resolve();
        document.addEventListener('DOMContentLoaded', () => resolve());
    });

    const select = document.querySelector.bind(document);

    const createEl = (el, attrs = {}, ns = 'http://www.w3.org/1999/xhtml') => {
        el = document.createElementNS(ns, el)
        Object.entries(attrs).forEach(([key, val]) => el.setAttribute(key, val));
        return el;
    };

    const noop = () => {};

    const makeStateH = state => (fn = noop) => (e = {}) => {
        e._state = state;
        return fn(e);
    };

    const store = JSON.parse(localStorage.getItem(config.storageKey)) || { graph: {} };
    const updateStore = () => localStorage.setItem(config.storageKey, JSON.stringify(store))

    ready().then(() => {
        const diagram = select('.diagram');
        const pane = select('.pane');
        const menu = {
            box: select('.add-box'),
            line: select('.add-line')
        };
        
        const withState = makeStateH({
            paneMatrix: new DOMMatrix(pane.style.transform),
            diagram, pane, menu,
            dragging: null,                 // element we're dragging
            connectingBoxes: false,         // we're connecting boxes
            frame: null,                    // animating draggable
            ptrX: null, ptrY: null,         // position of the pointer within the diagram
            scrollY: 0,                     // scroll y delta
            firstBox: null,                 // first selected box when adding lines
            connectingLine: null,           // a new line
            uid: -1,                        // unique id
            store,                          // initial storage state
            commit: updateStore             // update localStorage 
        });

        const stop = (fn = noop) => e => {
            e.preventDefault();
            e.stopPropagation();
            return fn(e);
        };

        const finishConnecting = s => {
            clearFrame(s);
            s.diagram.classList.remove('connecting-boxes');
            if (s.firstBox) s.firstBox.classList.remove('active');
            if (s.connectingLine) s.connectingLine.classList.remove('active');
            s.firstBox = null;
            s.connectingLine = null;
            s.connectingBoxes = false;
        };

        const stopConnecting = s => {
            if (s.connectingLine) s.connectingLine.parentElement.removeChild(s.connectingLine);
            finishConnecting(s);
        };

        const withStart = (fn = noop) => e => {
            if (e._state.dragging) stopDragging(e._state);
            if (e._state.connectingBoxes) stopConnecting(e._state);
            fn(e);
        };

        const whenConnecting = (fn = noop) => e => e._state.connectingBoxes && fn(e);
        const whenAnimating = (fn = noop) => e => e._state.frame && fn(e);

        const set = (pos, x) => pos.baseVal.value = x;
        const shift = (pos, x) => pos.baseVal.value += x;

        const moveBoxFrom = (s, prevX, prevY) => () => {
            const dragging = s.dragging;

            const diffX = s.ptrX - prevX;
            const diffY = s.ptrY - prevY;

            shift(dragging.x, diffX);
            shift(dragging.y, diffY);

            dragging._edges.forEach(line => {
                if (line._nodes[0] === dragging) shift(line.x1, diffX), shift(line.y1, diffY);
                else shift(line.x2, diffX), shift(line.y2, diffY);
            });

            s.frame = requestAnimationFrame(moveBoxFrom(s, s.ptrX, s.ptrY));
        };

        const moveLineFrom = (s, prevX, prevY) => () => {
            const connectingLine = s.connectingLine;
            shift(connectingLine.x2, s.ptrX - prevX);
            shift(connectingLine.y2, s.ptrY - prevY);
            s.frame = requestAnimationFrame(moveLineFrom(s, s.ptrX, s.ptrY));
        };

        const addBox = (container, x, y, text = config.placeholder) => {
            const box = createEl('foreignObject', {
                'class': 'box', x, y,
                height: 1, width: 1
            }, 'http://www.w3.org/2000/svg');

            const boxFrame = box.appendChild(createEl('div', {
                'class': 'frame',
                'tabindex': -1,
                xmlns: 'http://www.w3.org/1999/xhtml'
            }));

            const contents = boxFrame.appendChild(createEl('pre', { 
                'class': 'contents',
                contenteditable: ''
            }));

            contents.innerText = text;

            box._edges = [];

            container.appendChild(box);

            return box;
        };

        const addLine = (container, x1, y1, x2, y2) => {
            const line = createEl('line', {
                x1, y1, x2, y2,
                'class': 'connector',
            }, 'http://www.w3.org/2000/svg');   

            line._nodes = [];
            container.insertBefore(line, container.firstChild);
            return line;
        };

        const deleteBox = (s, box) => {
            box._edges.forEach(line => {
                const other = line._nodes[0] === box ? 
                    line._nodes[1] : line._nodes[0];

                other._edges.splice(other._edges.indexOf(line), 1);
                line._nodes = null;
                delete s.store.graph[line._id];
                line.parentElement.removeChild(line);
            });

            box._edges = null;
            delete s.store.graph[box._id];
            box.parentElement.removeChild(box);
            s.commit();
        };

        const storeBox = (s, box) => {
            if (box._id === undefined) box._id = s.uid++;

            const contents = box.querySelector('.contents');

            s.store.graph[box._id] = {
                type: 'box',
                id: box._id,
                x: box.x.baseVal.value,
                y: box.y.baseVal.value,
                text: contents.innerText
            };
        };

        const storeLine = (s, line) => {
            if (line._id === undefined) line._id = s.uid++;

            s.store.graph[line._id] = {
                type: 'line',
                id: line._id,
                x1: line.x1.baseVal.value,
                y1: line.y1.baseVal.value,
                x2: line.x2.baseVal.value,
                y2: line.y2.baseVal.value,
                nodes: [
                    line._nodes[0]._id,
                    line._nodes[1]._id
                ]
            };
        };

        const panFrom = (s, prevX, prevY) => () => {
            s.paneMatrix.translateSelf(s.ptrX - prevX, s.ptrY - prevY);
            s.pane.style.transform = s.paneMatrix.toString();
            s.frame = requestAnimationFrame(panFrom(s, s.ptrX, s.ptrY));
        };

        const zoomFrom = (s, prevY) => () => {
            const srange = config.scrollRange,
                factor = 2 ** ((s.scrollY - prevY + srange * 2) / srange - 2);
            s.paneMatrix.scaleSelf(factor, factor);
            s.pane.style.transform = s.paneMatrix.toString();
            if (s.scrollY !== prevY) s.frame = requestAnimationFrame(zoomFrom(s, s.scrollY));
            else s.frame = null;
        };

        const startDragging = (s, el) => {
            s.dragging = el;
            s.frame = requestAnimationFrame(moveBoxFrom(s, s.ptrX, s.ptrY));
        };

        const startPanning = s => (s.frame = requestAnimationFrame(panFrom(s, s.ptrX, s.ptrY)));
        const startZooming = s => (s.frame = requestAnimationFrame(zoomFrom(s, s.scrollY)));

        const clearFrame = s => {
            if (!s.frame) return;
            cancelAnimationFrame(s.frame);
            s.frame = null;
        };

        const finishDragging = s => {
            s.dragging = null;
            clearFrame(s);
        };

        const stopDragging = s => {
            s.dragging.parentElement.removeChild(s.dragging);
            finishDragging(s);
        };

        const connectBoxes = (s, box) => {
            const boxFrame = box.firstElementChild;
            set(s.connectingLine.x2, box.x.baseVal.value + boxFrame.offsetWidth / 2);
            set(s.connectingLine.y2, box.y.baseVal.value + boxFrame.offsetHeight / 2);

            s.connectingLine._nodes = [s.firstBox, box];

            if (hasEdge(box, s.connectingLine)) {
                stopConnecting(s);
                return;
            }

            s.firstBox._edges.push(s.connectingLine);
            box._edges.push(s.connectingLine);

            storeLine(s, s.connectingLine);
            storeBox(s, s.firstBox);
            storeBox(s, box);
            s.commit();

            finishConnecting(s);
        };

        const startConnecting = (s, box) => {
            const boxFrame = box.firstElementChild;

            s.firstBox = box;
            s.connectingLine = addLine(s.pane, 
                box.x.baseVal.value + boxFrame.offsetWidth / 2,
                box.y.baseVal.value + boxFrame.offsetHeight / 2,
                s.ptrX, 
                s.ptrY
            );

            s.connectingLine.classList.add('active');
            box.classList.add('active');
            s.frame = requestAnimationFrame(moveLineFrom(s, s.ptrX, s.ptrY));
        }

        const setP = e => {
            const { left, top } = e._state.diagram.getBoundingClientRect();
            e._state.ptrX = e.clientX - left; 
            e._state.ptrY = e.clientY - top;
        };

        const edgeEq = a => b => (
            a._nodes[0] === b._nodes[0] &&
            a._nodes[1] === b._nodes[1] ||
            a._nodes[0] === b._nodes[1] &&
            a._nodes[1] === b._nodes[0]);

        const hasEdge = (box, line) =>
            box._edges.some(edgeEq(line));

        const render = (e) => {
            const s = e._state;
            const nodes = {};

            Object.values(s.store.graph).forEach(item => {
                if (item.type === 'box') {
                    const box = addBox(s.pane, item.x, item.y, item.text);
                    box._id = item.id;
                    nodes[box._id] = box;
                } else if (item.type == 'line') {
                    const line = addLine(s.pane, item.x1, item.y1, item.x2, item.y2);
                    line._id = item.id;
                    line._nodes = [
                        nodes[item.nodes[0]],
                        nodes[item.nodes[1]]
                    ];
                    line._nodes[0]._edges.push(line);
                    line._nodes[1]._edges.push(line);
                }

                s.uid = item.id;
            });

            s.uid++;
        };

        menu.box.addEventListener('click', withState(stop(withStart(e => {
            setP(e);
            const box = addBox(e._state.pane, e._state.ptrX, e._state.ptrY)
            const boxFrame = box.firstElementChild;
            box.x.baseVal.value -= boxFrame.offsetWidth / 2;
            box.y.baseVal.value -= boxFrame.offsetHeight / 2;
            startDragging(e._state, box);
        }))));

        menu.line.addEventListener('click', withState(stop(withStart(e => {
            e._state.diagram.classList.add('connecting-boxes')
            e._state.connectingBoxes = true;
        }))));

        diagram.addEventListener('pointerdown', withState(e => {
            const s = e._state;
            if (s.connectingBoxes) e.preventDefault();
            if (s.frame || s.connectingBoxes) return;

            const box = e.target.closest('.box');
            if (box) startDragging(s, box); 
            else startPanning(s);
        }));

        diagram.addEventListener('pointermove', withState(e => setP(e)));
        diagram.addEventListener('pointerup', withState(whenAnimating(e => {
            const s = e._state;

            if (s.dragging) {
                storeBox(s, s.dragging);
                s.dragging._edges.forEach(line => storeLine(s, line));
                s.commit();
                finishDragging(s);
            } 

            clearFrame(s);
        })));

        diagram.addEventListener('wheel', withState(e => {
            const s = e._state, srange = config.scrollRange;
            e.preventDefault();
            s.scrollY += e.deltaY;
            if (s.scrollY < -srange) s.scrollY = -srange;
            else if (s.scrollY > srange) s.scrollY = srange;
            console.log(s.scrollY);
            if (!s.frame) startZooming(s);
        }));

        diagram.addEventListener('click', withState(whenConnecting(e => {
            const s = e._state;

            const box = e.target.closest('.box');
            if (!box || box === s.firstBox) {
                stopConnecting(s);
                return;
            }

            if (s.firstBox) connectBoxes(s, box);
            else startConnecting(s, box);
        })));

        diagram.addEventListener('keyup', withState(e => {
            const box = e.target.closest('.box');
            if (e.target.classList.contains('contents')) return;
            if (e.key.toLowerCase() !== 'backspace') return;
            box && deleteBox(e._state, box);
        }));

        diagram.addEventListener('focusin', e => {
            e.stopPropagation();
            const box = e.target.closest('.box');
            box && box.classList.add('focus');
        });

        diagram.addEventListener('focusout', withState(e => {
            e.stopPropagation();
            const box = e.target.closest('.box');
            box && box.classList.remove('focus');
            if (!box || !e.target.isContentEditable) return;
            storeBox(e._state, box);
            e._state.commit();
        }));

        withState(render)();
    });
})();
 
