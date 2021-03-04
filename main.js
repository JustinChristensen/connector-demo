(function () {
    const ready = () => new Promise(resolve => {
        if (document.readyState !== 'loading') return resolve();
        document.addEventListener('DOMContentLoaded', () => resolve());
    });

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

    ready().then(() => {
        const container = document.querySelector('.diagram-container');
        const diagram = document.querySelector('.diagram');
        const menu = {
            box: document.querySelector('.add-box'),
            line: document.querySelector('.add-line')
        };

        const config = {
            placeholder: 'Stuff and things'
        };

        const withState = makeStateH({
            dragging: null,                 // element we're dragging
            connectingBoxes: false,         // we're connecting boxes
            frame: null,                    // animating draggable
            ptrX: null, ptrY: null,        // position of the pointer within the diagram
            firstBox: null,                 // first selected box when adding lines
            connectingLine: null            // the new line
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

        const addBox = s => {
            const box = createEl('foreignObject', {
                'class': 'box',
                x: s.ptrX, 
                y: s.ptrY
            }, 'http://www.w3.org/2000/svg');

            const boxFrame = box.appendChild(createEl('div', {
                'class': 'frame',
                xmlns: 'http://www.w3.org/1999/xhtml'
            }));

            const code = createEl('code', { contenteditable: '' });
            code.textContent = config.placeholder;
            boxFrame.appendChild(code);

            box._edges = [];

            diagram.appendChild(box);

            box.x.baseVal.value -= boxFrame.offsetWidth / 2;
            box.y.baseVal.value -= boxFrame.offsetHeight / 2;

            return box;
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
            const { left, top } = diagram.getBoundingClientRect();
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

        menu.box.addEventListener('click', withState(stop(withStart(e => {
            setP(e);
            startDragging(e._state, addBox(e._state));
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
        diagram.addEventListener('pointerup', withState(whenDragging(e => finishDragging(e._state))));

        diagram.addEventListener('click', withState(whenConnecting(e => {
            const box = e.target.closest('.box');

            if (!box || box.classList.contains('active')) {
                stopConnecting(e._state);
                return;
            }

            const { firstBox, connectingLine, ptrX, ptrY } = e._state;
            const boxFrame = box.firstElementChild;

            if (firstBox) {
                set(connectingLine.x2, box.x.baseVal.value + boxFrame.offsetWidth / 2);
                set(connectingLine.y2, box.y.baseVal.value + boxFrame.offsetHeight / 2);

                connectingLine._nodes = [firstBox, box];

                if (hasEdge(box, connectingLine)) {
                    stopConnecting(e._state);
                    return;
                }

                firstBox._edges.push(connectingLine);
                box._edges.push(connectingLine);

                finishConnecting(e._state);
            } else {
                e._state.firstBox = box;
                e._state.connectingLine = createEl('line', {
                    'class': 'connector active',
                    x1: box.x.baseVal.value + boxFrame.offsetWidth / 2,
                    y1: box.y.baseVal.value + boxFrame.offsetHeight / 2,
                    x2: ptrX, 
                    y2: ptrY
                }, 'http://www.w3.org/2000/svg');  

                box.classList.add('active');
                diagram.insertBefore(e._state.connectingLine, diagram.firstChild);
                e._state.frame = requestAnimationFrame(moveLineFrom(e._state, ptrX, ptrY));
            }
        })));
    });
})();
 
