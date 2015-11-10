function nanofilter(server, port, k) {
    var _schema, _filters = {}, _groups = {}, _data, _group_id = 17;

    function query_url(q) {
        return 'http://' + server + ':' + port + '/' + q;
    }

    function do_query(q, k) {
        d3.json(query_url(q), k);
    }

    function do_queries(qs, k) {
        var Q = queue();
        qs.forEach(function(q) {
            Q.defer(d3.json, query_url(q));
        });
        Q.await(k);
    }

    function build_query(group) {
        var parts = ['count'];
        for(var f in _filters) {
            if(group && group.dimension === f)
                continue;
            var filter;
            switch(_filters[f].type) {
            case 'set':
                filter = 'set(' + _filters[f].target.join(',') + ')';
                break;
            case 'interval':
                filter = 'interval(' + _filters[f].target.join(',') + ')';
                break;
            }
            parts.push('.r("' + f + '",' + filter + ')');
        }
        if(group.type)
            parts.push('.a("' + group.dimension + '",' + group.type + '(' + group.args.join(',') + '))');
        return parts.join('');
    }

    var nf = {};

    nf.dimension = function(field) {
        if(!_schema)
            throw new Error('no schema');
        if(!_schema.fields.find(function(f) { return f.name === field; }))
            throw new Error('field ' + field + ' not found in schema');
        return {
            filter: function(v) {
                if(v !== null)
                    throw new Error('unexpected non-null filter()');
                delete _filters[field];
                return this;
            },
            filterExact: function(val) {
                _filters[field] = {type: 'set', target: [val]};
                return this;
            },
            filterRange: function(range) {
                _filters[field] = {type: 'interval', target: range};
                return this;
            },
            filterFunction: function() {
                throw new Error('filter functions not allowed');
            },
            dispose: function() {
                this.filter(null);
                return this;
            },
            group: function() {
                var _id = _group_id++, _anchor = {id: _id, dimension: field, values: null};
                _groups[_id] = _anchor;

                function capture(name) {
                    return function() {
                        _anchor.type = name;
                        _anchor.args = Array.prototype.slice.call(arguments, 0);
                        return this;
                    };
                }
                return {
                    mt_interval_sequence: capture('mt_interval_sequence'),
                    dive: capture('dive'),
                    dispose: function() {
                        delete _groups[_id];
                        _anchor.values = null;
                        return this;
                    },
                    all: function() {
                        return _anchor.values;
                    }
                };
            }
        };
    };

    function validate(data) {
        function expect() {
            var d = data;
            for(var i = 0; i < arguments.length; ++i) {
                if(!d[arguments[i]]) {
                    console.log('expected data.' + Array.prototype.slice.call(arguments, 0, i).join('.'));
                    return false;
                }
                d = d[arguments[i]];
            }
            return true;
        }
        expect('layers');
        expect('root', 'children');
    }

    nf.commit = function(k) {
        var ids = Object.keys(_groups), qs = [];
        for(var id in _groups)
            qs.push(build_query(_groups[id]));
        do_queries(qs, function(error) {
            if(error)
                throw new Error(error);
            if(arguments.length !== qs.length + 1)
                throw new Error('unexpected number of arguments ' + arguments.length);

            for(var i = 1; i < arguments.length; ++i) {
                var result = arguments[i], id = ids[i-1];
                _groups[id].values = result.root.children.map(function(pv) {
                    return {key: pv.path[0], value: pv.val};
                });
            }
            if(!error && validate(result))
                _data = result;
            k(error, result);
        });
    };

    do_query('schema', function(error, schema) {
        if(error)
            k(error, schema);
        else {
            _schema = schema;
            k(error, schema);
        }
    });

    return nf;
}
