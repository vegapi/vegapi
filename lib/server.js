// Copyright (c) 2012 Mark Cavage. All rights reserved.
// Copyright (c) 2015 Pedro Vieira.

//var fs = require('fs');
//var path = require('path');
var util = require('util');
var parseUrl = require('url');
var assert = require('assert-plus');
var bunyan = require('bunyan');
var logentries = require('bunyan-logentries');
var restify = require('restify');
var path = require('path');
var auditLogs = require('./auditLogs');
var companies = require('./companies');
var documents = require('./documents');
var entities = require('./entities');
var items = require('./items');
var users = require('./users');
var profiles = require('./profiles');

///--- Handlers

///--- API

// Returns a server with all routes defined on it

function createServer(options) {
    assert.object(options, 'options');
    assert.string(options.directory, 'options.directory');
    assert.object(options.log, 'options.log');
    assert.object(options.database, 'options.database');
    assert.string(options.logToken, 'options.logToken');

    function setup(req, res, next) {
        req.dir = options.directory;
        req.db = options.database;
        req.log = options.log;
        req.url = parseUrl.parse(req.url, true);
        next();
    }

    function authenticate(req, res, next) {
        if (!options.application) {
            req.log.debug('Skipping authentication');
            next();
            return;
        }

        var authz = req.authorization.basic;
        if (!authz) {
            res.setHeader('WWW-Authenticate', 'Basic realm="' + options.application + '"');
            next(new restify.UnauthorizedError('Authentication required'));
            return;
        }

        if (authz.username !== options.application || authz.password !== options.key) {
            res.setHeader('WWW-Authenticate', 'Basic realm="' + options.application + '"');
            req.log.info('Authentication failed - invalid credentials ', authz);
            next(new restify.InvalidCredentialsError('Authentication failed - invalid credentials'));
            return;
        }

        next();
    }

    var server = restify.createServer({
        log: options.log,
        name: options.application,
        version: '0.1.0',
        acceptable: ['application/json']
    });

    // Ensure we don't drop data on uploads
    server.pre(restify.pre.pause());

    // Clean up sloppy paths like //todo//////1//
    server.pre(restify.pre.sanitizePath());

    // Handles annoying user agents (curl)
    server.pre(restify.pre.userAgentConnection());

    // Set a per request bunyan logger (with requestid filled in)
    server.use(restify.requestLogger());

    // Allow 50 requests/second by IP, and burst to 100
    server.use(restify.throttle({
        burst: 100,
        rate: 50,
        ip: true,
    }));

    // Use the common stuff you probably want
    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.dateParser());
    server.use(restify.authorizationParser());
    server.use(restify.queryParser({mapParams: false}));
    server.use(restify.gzipResponse());
    server.use(restify.bodyParser({
        mapParams: false,
        maxBodySize: 0,
    }));

    // Setup data for database and authentication/authorization
    server.use(setup);
    server.use(authenticate);

    // Register audit log handler
    server.get('/audit-logs', auditLogs.listLogs);
    server.get('/audit-logs/:logId', auditLogs.getLog);

    // Register root '/' (companies) handler
    server.post('/', [companies.validateCompany, 
                      companies.createCompany]);
    server.get('/', companies.listCompanies);
    server.get('/:companyId', companies.getCompany);
    server.put('/:companyId', [companies.validateCompany,
                          companies.putCompany]);
    server.del('/:companyId', companies.deleteCompany);

    // Register documents handler
    server.post('/:companyId/documents', [documents.validateDocument, 
                                          documents.createDocument]);
    server.get('/:companyId/documents', documents.listDocuments);
    server.get('/:companyId/documents/:documentId', documents.getDocument);
    server.put('/:companyId/documents/:documentId', [documents.validateDocument,
                                                     documents.putDocument]);
    server.del('/:companyId/documents/:documentId', documents.deleteDocument);

    // Register entities handler
    server.post('/:companyId/entities', [entities.validateEntity, 
                                          entities.createEntity]);
    server.get('/:companyId/entities', entities.listEntities);
    server.get('/:companyId/entities/:entityId', entities.getEntity);
    server.put('/:companyId/entities/:entityId', [entities.validateEntity,
                                                     entities.putEntity]);
    server.del('/:companyId/entities/:entityId', entities.deleteEntity);

    // Register items handler
    server.post('/:companyId/items', [items.validateItem, 
                                          items.createItem]);
    server.get('/:companyId/items', items.listItems);
    server.get('/:companyId/items/:itemId', items.getItem);
    server.put('/:companyId/items/:itemId', [items.validateItem,
                                                     items.putItem]);
    server.del('/:companyId/items/:itemId', items.deleteItem);

    // Register users handler
    server.post('/:companyId/users', [users.validateUser, 
                                          users.createUser]);
    server.get('/:companyId/users', users.listUsers);
    server.get('/:companyId/users/:userId', users.getUser);
    server.put('/:companyId/users/:userId', [users.validateUser,
                                                     users.putUser]);
    server.del('/:companyId/users/:userId', users.deleteUser);

    // Register profiles handler
    server.post('/:companyId/profiles', [profiles.validateProfile, 
                                          profiles.createProfile]);
    server.get('/:companyId/profiles', profiles.listProfiles);
    server.get('/:companyId/profiles/:profileId', profiles.getProfile);
    server.put('/:companyId/profiles/:profileId', [profiles.validateProfile,
                                                     profiles.putProfile]);
    server.del('/:companyId/profiles/:profileId', profiles.deleteProfile);

    // Setup an audit logger
    if (!options.noAudit) {
        server.on('after', auditLogs.auditLogger({
            body: true,
            log: bunyan.createLogger({
                level: 'info',
                name: options.name,
                streams: [{
                    type: 'rotating-file',
                    path: path.join(options.directory, 'logs/audit.log'),
                    period: '2h',
                    count: 12
                }]
            })
        }));
    }

    return (server);
}


///--- Exports

module.exports = {
    createServer: createServer
};
