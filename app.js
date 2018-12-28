var express = require('express'),
    elasticsearch = require('elasticsearch'),
    url = require('url'),
    http = require('http'),
    app = express(),
    server = http.createServer(app),
    path = require('path'),
    logger = require('morgan'),
    methodOverride = require('method-override'),
    bodyParser = require('body-parser'),
    errorHandler = require('errorhandler'),
    fs = require('fs');

var elasticSearchUrl = 'localhost:9200';
if (process.env.ELASTICSEARCH_URL) {
    elasticSearchUrl = process.env.ELASTICSEARCH_URL;
}

var client = new elasticsearch.Client({
    host: elasticSearchUrl,
    log: 'debug'
});

var _index = "deployments";
var _type = 'endpoint';

// configuration
app.set('port', process.env.PORT || 12345);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(logger('dev'));
app.use(methodOverride());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static(path.join(__dirname, 'public')));

// Provide a route for reprocessing some data
app.get('/reprocess', function (req, res) {
    client.indices.delete({index: _index});
    client.indices.create({
        index: _index,
        body: {
            "settings": {
                "analysis": {
                    "filter": {
                        "autocomplete_filter": {
                            "type": "edge_ngram",
                            "min_gram": 1,
                            "max_gram": 10
                        }
                    },
                    "analyzer": {
                        "autocomplete": {
                            "type": "custom",
                            "tokenizer": "standard",
                            "filter": [
                                "lowercase",
                                "autocomplete_filter"
                            ]
                        }
                    }
                }
            },
            "mappings": {
                "endpoint": {
                    "properties": {
                        "dev": {
                            "type": "string",
                            "fields": {
                                "raw": {"type": "string", "index": "not_analyzed"}
                            }
                        },
                        "category": {
                            "type": "string",
                            "fields": {
                                "raw": {"type": "string", "index": "not_analyzed"}
                            }
                        },
                        "name": {
                            "type": "string",
                            "fields": {
                                "autocomplete": {"type": "string", "index_analyzer": "autocomplete"}
                            }
                        },
                        "platform": {
                            "type": "string"
                        },
                        "prod": {
                            "type": "string", "index": "not_analyzed"
                        },
                        "qa": {
                            "type": "string",
                            "fields": {
                                "raw": {"type": "string", "index": "not_analyzed"}
                            }
                        },
                        "int": {
                            "type": "string",
                            "fields": {
                                "raw": {"type": "string", "index": "not_analyzed"}
                            }
                        }
                    }
                }
            }
        }

    }, function (error, response) {
        fs.readFile('endpoints.json', 'utf8', function (err, data) {
            if (err) throw err;
            var body = [];
            JSON.parse(data).forEach(function (item) {
                body.push({"index": {"_index": _index, "_type": _type}});
                body.push(item);
            });

            client.bulk({
                body: body
            }, function (err, resp) {
                res.render('index', {result: 'Indexing Completed!'});
            })
        });
    })
})
;

app.get('/autocomplete', function (req, res) {
    client.search({
        index: _index,
        type: _type,
        body: {
            "query": {
                "filtered": {
                    "query": {
                        "multi_match": {
                            "query": req.query.term,
                            "fields": ["name.autocomplete"]
                        }
                    }
                }

            }
        }
    }).then(function (resp) {
        var results = resp.hits.hits.map(function(hit){
            return hit._source.name;
        });

        res.send(results);
    }, function (err) {
        console.trace(err.message);
        res.send({response: err.message});
    });
});

app.get('/', function (req, res) {
    var aggValue = req.query.agg_value;
    var aggField = req.query.agg_field;

    var filter = {};
    filter[aggField] = aggValue;

    client.search({
        index: _index,
        type: _type,
        body: {
            "query": {
                "filtered": {
                    "query": {
                        "multi_match": {
                            "query": req.query.q,
                            "fields": ["name^100", "platform^20", "category^5", "dev^3", "int^10", "qa^50"],
                            "fuzziness": 1
                        }
                    },
                    "filter": {
                        "term": (aggField ? filter : undefined)
                    }
                }

            },
            "aggs": {
                "category": {
                    "terms": {
                        "field": "category.raw"
                    }
                },
                "dev": {
                    "terms": {
                        "field": "dev.raw"
                    }
                },
                "int": {
                    "terms": {
                        "field": "int.raw"
                    }
                },
                "qa": {
                    "terms": {
                        "field": "qa.raw"
                    }
                },
                "prod": {
                    "terms": {
                        "field": "prod"
                    }
                }
            },
            "suggest": {
                "text": req.query.q,
                "simple_phrase": {
                    "phrase": {
                        "field": "name",
                        "size": 1,
                        "real_word_error_likelihood": 0.95,
                        "max_errors": 0.5,
                        "gram_size": 2,
                        "direct_generator": [{
                            "field": "name",
                            "suggest_mode": "always",
                            "min_word_length": 1
                        }],
                        "highlight": {
                            "pre_tag": "<b><em>",
                            "post_tag": "</em></b>"
                        }
                    }
                }
            }
        }
    }).then(function (resp) {
        res.render('search', {response: resp, query: req.query.q});
    }, function (err) {
        console.trace(err.message);
        res.render('search', {response: err.message});
    });
});

// error handling middleware should be loaded after the loading the routes
if ('development' == app.get('env')) {
    app.use(errorHandler());
}

app.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + app.get('port'));
});

