(function () {
    const config = {
        placeholder: 'Stuff and things',
        storageKey: 'data'
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

    const makeStateH = state => (fn = noop) => e => {
        e._state = state;
        return fn(e);
    };

    const store = JSON.parse(localStorage.getItem(config.storageKey)) || {
        uid: 0,
        graph: {}
    };

    const updateStore = () => localStorage.setItem(config.storageKey, JSON.stringify(store))

    ready().then(() => {
        const container = select('.diagram-container');
        const diagram = select('.diagram');
        const menu = {
            box: select('.add-box'),
            line: select('.add-line')
        };

        const withState = makeStateH({
            diagram, container, menu,
            dragging: null,                 // element we're dragging
            connectingBoxes: false,         // we're connecting boxes
            frame: null,                    // animating draggable
            ptrX: null, ptrY: null,         // position of the pointer within the diagram
            firstBox: null,                 // first selected box when adding lines
            connectingLine: null,           // a new line
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
            container.classList.remove('connecting-boxes');
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

        const whenDragging = (fn = noop) => e => {
            e._state.dragging && fn(e);
        };

        const whenConnecting = (fn = noop) => e => {
            e._state.connectingBoxes && fn(e);
        };

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

        const addBox = (diagram, x, y, text = config.placeholder) => {
            const box = createEl('foreignObject', {
                'class': 'box', x, y
            }, 'http://www.w3.org/2000/svg');

            const boxFrame = box.appendChild(createEl('div', {
                'class': 'frame',
                xmlns: 'http://www.w3.org/1999/xhtml'
            }));

            const contents = boxFrame.appendChild(createEl('pre', { 
                'class': 'contents',
                contenteditable: '' 
            }));

            contents.innerText = text;

            box._edges = [];

            diagram.appendChild(box);

            return box;
        };

        const addLine = (diagram, x1, y1, x2, y2) => {
            const line = createEl('line', {
                x1, y1, x2, y2,
                'class': 'connector',
            }, 'http://www.w3.org/2000/svg');   

            line._nodes = [];
            diagram.insertBefore(line, diagram.firstChild);
            return line;
        };

        const storeBox = (s, box) => {
            if (box._id === undefined) box._id = s.store.uid++;

            const contents = box.querySelector('pre');

            s.store.graph[box._id] = {
                type: 'box',
                id: box._id,
                x: box.x.baseVal.value,
                y: box.y.baseVal.value,
                text: contents.innerText
            };
        };

        const storeLine = (s, line) => {
            if (line._id === undefined) line._id = s.store.uid++;

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

        const startDragging = (s, el) => {
            s.dragging = el;
            s.frame = requestAnimationFrame(moveBoxFrom(s, s.ptrX, s.ptrY));
        };

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

        const render = (diagram, store) => {
            const nodes = {};

            Object.values(store.graph).forEach(item => {
                if (item.type === 'box') {
                    const box = addBox(diagram, item.x, item.y, item.text);
                    box._id = item.id;
                    nodes[box._id] = box;
                } else if (item.type == 'line') {
                    const line = addLine(diagram, item.x1, item.y1, item.x2, item.y2);
                    line._id = item.id;
                    line._nodes = [
                        nodes[item.nodes[0]],
                        nodes[item.nodes[1]]
                    ];
                    line._nodes[0]._edges.push(line);
                    line._nodes[1]._edges.push(line);
                }
            });
        };

        menu.box.addEventListener('click', withState(stop(withStart(e => {
            setP(e);
            const box = addBox(e._state.diagram, e._state.ptrX, e._state.ptrY)
            const boxFrame = box.firstElementChild;
            box.x.baseVal.value -= boxFrame.offsetWidth / 2;
            box.y.baseVal.value -= boxFrame.offsetHeight / 2;
            startDragging(e._state, box);
        }))));

        menu.line.addEventListener('click', withState(stop(withStart(e => {
            container.classList.add('connecting-boxes')
            e._state.connectingBoxes = true;
        }))));

        diagram.addEventListener('pointerdown', withState(e => {
            if (e._state.connectingBoxes) e.preventDefault();
            if (e._state.dragging || e._state.connectingBoxes) return;

            const box = e.target.closest('.box');
            box && startDragging(e._state, box); 
        }));

        diagram.addEventListener('pointermove', withState(e => setP(e)));
        diagram.addEventListener('pointerup', withState(whenDragging(e => {
            const s = e._state;
            storeBox(s, s.dragging);
            s.dragging._edges.forEach(line => storeLine(s, line));
            s.commit();
            finishDragging(s);
        })));

        diagram.addEventListener('click', withState(whenConnecting(e => {
            const s = e._state;

            const box = e.target.closest('.box');
            if (!box || box === s.firstBox) {
                stopConnecting(s);
                return;
            }

            const boxFrame = box.firstElementChild;

            if (s.firstBox) {
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
            } else {
                s.firstBox = box;
                s.connectingLine = addLine(s.diagram, 
                    box.x.baseVal.value + boxFrame.offsetWidth / 2,
                    box.y.baseVal.value + boxFrame.offsetHeight / 2,
                    s.ptrX, 
                    s.ptrY
                );

                s.connectingLine.classList.add('active');
                box.classList.add('active');
                s.frame = requestAnimationFrame(moveLineFrom(s, s.ptrX, s.ptrY));
            }
        })));

        diagram.addEventListener('focusout', withState(e => {
            const box = e.target.closest('.box');
            if (!box || !e.target.isContentEditable) return;
            storeBox(e._state, box);
            e._state.commit();
        }));

        render(diagram, store);
    });
})();
 
