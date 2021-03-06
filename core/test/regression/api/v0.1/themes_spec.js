var should = require('should'),
    supertest = require('supertest'),
    testUtils = require('../../../utils/index'),
    localUtils = require('./utils'),
    config = require('../../../../server/config/index'),
    ghost = testUtils.startGhost,
    fs = require('fs-extra'),
    path = require('path'),
    uuid = require('uuid'),
    os = require('os'),
    _ = require('lodash'),
    request;

describe('Themes API', function () {
    var scope = {
            ownerAccessToken: '',
            editorAccessToken: '',
            uploadTheme: function uploadTheme(options) {
                var themePath = options.themePath,
                    fieldName = options.fieldName || 'theme',
                    accessToken = options.accessToken || scope.ownerAccessToken;

                return request.post(localUtils.API.getApiQuery('themes/upload'))
                    .set('Authorization', 'Bearer ' + accessToken)
                    .attach(fieldName, themePath);
            },
            editor: null
        }, ghostServer, contentFolder = path.join(os.tmpdir(), uuid.v4(), 'ghost-test');

    before(function () {
        return ghost()
            .then(function (_ghostServer) {
                ghostServer = _ghostServer;
                request = supertest.agent(config.get('url'));
            })
            .then(function () {
                return localUtils.doAuth(request);
            })
            .then(function (token) {
                scope.ownerAccessToken = token;

                return testUtils.createUser({
                    user: testUtils.DataGenerator.forKnex.createUser({email: 'test+1@ghost.org'}),
                    role: testUtils.DataGenerator.Content.roles[1].name
                });
            })
            .then(function (user) {
                scope.editor = user;

                request.user = scope.editor;
                return localUtils.doAuth(request);
            })
            .then(function (token) {
                scope.editorAccessToken = token;

                return testUtils.createUser({
                    user: testUtils.DataGenerator.forKnex.createUser({email: 'test+author@ghost.org'}),
                    role: testUtils.DataGenerator.Content.roles[2].name
                });
            })
            .then(function (user) {
                scope.author = user;

                request.user = scope.author;
                return localUtils.doAuth(request);
            })
            .then(function (token) {
                scope.authorAccessToken = token;
            });
    });

    describe('success cases', function () {
        it('get all themes', function (done) {
            request.get(localUtils.API.getApiQuery('themes/'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    var jsonResponse = res.body;
                    should.exist(jsonResponse.themes);
                    localUtils.API.checkResponse(jsonResponse, 'themes');
                    jsonResponse.themes.length.should.eql(5);

                    localUtils.API.checkResponse(jsonResponse.themes[0], 'theme');
                    jsonResponse.themes[0].name.should.eql('broken-theme');
                    jsonResponse.themes[0].package.should.be.an.Object().with.properties('name', 'version');
                    jsonResponse.themes[0].active.should.be.false();

                    localUtils.API.checkResponse(jsonResponse.themes[1], 'theme', 'templates');
                    jsonResponse.themes[1].name.should.eql('casper');
                    jsonResponse.themes[1].package.should.be.an.Object().with.properties('name', 'version');
                    jsonResponse.themes[1].active.should.be.true();

                    localUtils.API.checkResponse(jsonResponse.themes[2], 'theme');
                    jsonResponse.themes[2].name.should.eql('casper-1.4');
                    jsonResponse.themes[2].package.should.be.an.Object().with.properties('name', 'version');
                    jsonResponse.themes[2].active.should.be.false();

                    localUtils.API.checkResponse(jsonResponse.themes[3], 'theme');
                    jsonResponse.themes[3].name.should.eql('test-theme');
                    jsonResponse.themes[3].package.should.be.false;
                    jsonResponse.themes[3].active.should.be.false();

                    localUtils.API.checkResponse(jsonResponse.themes[4], 'theme');
                    jsonResponse.themes[4].name.should.eql('test-theme-channels');
                    jsonResponse.themes[4].package.should.be.false;
                    jsonResponse.themes[4].active.should.be.false();

                    done();
                });
        });

        it('download theme', function (done) {
            request.get(localUtils.API.getApiQuery('themes/casper/download/'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect('Content-Type', /application\/zip/)
                .expect('Content-Disposition', 'attachment; filename=casper.zip')
                .expect(200)
                .end(function (err) {
                    if (err) {
                        return done(err);
                    }

                    done();
                });
        });

        it('upload new "valid" theme', function (done) {
            var jsonResponse;

            scope.uploadTheme({themePath: path.join(__dirname, '..', '..', '..', 'utils', 'fixtures', 'themes', 'valid.zip')})
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    jsonResponse = res.body;

                    should.exist(jsonResponse.themes);
                    localUtils.API.checkResponse(jsonResponse, 'themes');
                    jsonResponse.themes.length.should.eql(1);
                    localUtils.API.checkResponse(jsonResponse.themes[0], 'theme');
                    jsonResponse.themes[0].name.should.eql('valid');
                    jsonResponse.themes[0].active.should.be.false();

                    // upload same theme again to force override
                    scope.uploadTheme({themePath: path.join(__dirname, '..', '..', '..', 'utils', 'fixtures', 'themes', 'valid.zip')})
                        .end(function (err, res) {
                            if (err) {
                                return done(err);
                            }

                            jsonResponse = res.body;

                            should.exist(jsonResponse.themes);
                            localUtils.API.checkResponse(jsonResponse, 'themes');
                            jsonResponse.themes.length.should.eql(1);
                            localUtils.API.checkResponse(jsonResponse.themes[0], 'theme');
                            jsonResponse.themes[0].name.should.eql('valid');
                            jsonResponse.themes[0].active.should.be.false();

                            // ensure tmp theme folder contains two themes now
                            const tmpFolderContents = fs.readdirSync(config.getContentPath('themes'));
                            tmpFolderContents.forEach((theme, index) => {
                                if (theme.match(/^\./)) {
                                    tmpFolderContents.splice(index, 1);
                                }
                            });
                            tmpFolderContents.should.be.an.Array().with.lengthOf(10);

                            tmpFolderContents.should.eql([
                                'broken-theme',
                                'casper',
                                'casper-1.4',
                                'casper.zip',
                                'invalid.zip',
                                'test-theme',
                                'test-theme-channels',
                                'valid',
                                'valid.zip',
                                'warnings.zip'
                            ]);

                            // Check the Themes API returns the correct result
                            request.get(localUtils.API.getApiQuery('themes/'))
                                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                                .expect(200)
                                .end(function (err, res) {
                                    if (err) {
                                        return done(err);
                                    }

                                    var addedTheme, casperTheme;
                                    jsonResponse = res.body;

                                    should.exist(jsonResponse.themes);
                                    localUtils.API.checkResponse(jsonResponse, 'themes');
                                    jsonResponse.themes.length.should.eql(6);

                                    // Casper should be present and still active
                                    casperTheme = _.find(jsonResponse.themes, {name: 'casper'});
                                    should.exist(casperTheme);
                                    localUtils.API.checkResponse(casperTheme, 'theme', 'templates');
                                    casperTheme.active.should.be.true();

                                    // The added theme should be here
                                    addedTheme = _.find(jsonResponse.themes, {name: 'valid'});
                                    should.exist(addedTheme);
                                    localUtils.API.checkResponse(addedTheme, 'theme');
                                    addedTheme.active.should.be.false();

                                    done();
                                });
                        });
                });
        });

        // NOTE: This test requires the previous upload test
        // @TODO make this test independent
        it('delete new "valid" theme', function (done) {
            var jsonResponse;

            request.del(localUtils.API.getApiQuery('themes/valid'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(204)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    jsonResponse = res.body;
                    // Delete requests have empty bodies
                    jsonResponse.should.eql({});

                    // ensure tmp theme folder contains one theme again now
                    const tmpFolderContents = fs.readdirSync(config.getContentPath('themes'));
                    tmpFolderContents.forEach((theme, index) => {
                        if (theme.match(/^\./)) {
                            tmpFolderContents.splice(index, 1);
                        }
                    });
                    tmpFolderContents.should.be.an.Array().with.lengthOf(9);

                    tmpFolderContents.should.eql([
                        'broken-theme',
                        'casper',
                        'casper-1.4',
                        'casper.zip',
                        'invalid.zip',
                        'test-theme',
                        'test-theme-channels',
                        'valid.zip',
                        'warnings.zip'
                    ]);

                    // Check the themes API returns the correct result after deletion
                    request.get(localUtils.API.getApiQuery('themes/'))
                        .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                        .expect(200)
                        .end(function (err, res) {
                            if (err) {
                                return done(err);
                            }

                            var deletedTheme, casperTheme;
                            jsonResponse = res.body;

                            should.exist(jsonResponse.themes);
                            localUtils.API.checkResponse(jsonResponse, 'themes');
                            jsonResponse.themes.length.should.eql(5);

                            // Casper should be present and still active
                            casperTheme = _.find(jsonResponse.themes, {name: 'casper'});
                            should.exist(casperTheme);
                            localUtils.API.checkResponse(casperTheme, 'theme', 'templates');
                            casperTheme.active.should.be.true();

                            // The deleted theme should not be here
                            deletedTheme = _.find(jsonResponse.themes, {name: 'valid'});
                            should.not.exist(deletedTheme);

                            done();
                        });
                });
        });

        it('upload new "warnings" theme that has validation warnings', function (done) {
            var jsonResponse;

            scope.uploadTheme({themePath: path.join(__dirname, '/../../../utils/fixtures/themes/warnings.zip')})
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    jsonResponse = res.body;

                    should.exist(jsonResponse.themes);
                    localUtils.API.checkResponse(jsonResponse, 'themes');
                    jsonResponse.themes.length.should.eql(1);
                    localUtils.API.checkResponse(jsonResponse.themes[0], 'theme', ['warnings']);
                    jsonResponse.themes[0].name.should.eql('warnings');
                    jsonResponse.themes[0].active.should.be.false();
                    jsonResponse.themes[0].warnings.should.be.an.Array();

                    // Delete the theme to clean up after the test
                    request.del(localUtils.API.getApiQuery('themes/warnings'))
                        .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                        .expect(204)
                        .end(function (err) {
                            if (err) {
                                return done(err);
                            }
                            done();
                        });
                });
        });

        it('activate "test-theme" valid theme that has warnings', function (done) {
            var jsonResponse, casperTheme, testTheme;

            // First check the browse response to see that casper is the active theme
            request.get(localUtils.API.getApiQuery('themes/'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(200)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    jsonResponse = res.body;

                    should.exist(jsonResponse.themes);
                    localUtils.API.checkResponse(jsonResponse, 'themes');
                    jsonResponse.themes.length.should.eql(5);

                    casperTheme = _.find(jsonResponse.themes, {name: 'casper'});
                    should.exist(casperTheme);
                    localUtils.API.checkResponse(casperTheme, 'theme', 'templates');
                    casperTheme.active.should.be.true();

                    testTheme = _.find(jsonResponse.themes, {name: 'test-theme'});
                    should.exist(testTheme);
                    localUtils.API.checkResponse(testTheme, 'theme');
                    testTheme.active.should.be.false();

                    // Finally activate the new theme
                    request.put(localUtils.API.getApiQuery('themes/test-theme/activate'))
                        .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                        .expect(200)
                        .end(function (err, res) {
                            if (err) {
                                return done(err);
                            }

                            jsonResponse = res.body;

                            should.exist(jsonResponse.themes);
                            localUtils.API.checkResponse(jsonResponse, 'themes');
                            jsonResponse.themes.length.should.eql(1);

                            casperTheme = _.find(jsonResponse.themes, {name: 'casper'});
                            should.not.exist(casperTheme);

                            testTheme = _.find(jsonResponse.themes, {name: 'test-theme'});
                            should.exist(testTheme);
                            localUtils.API.checkResponse(testTheme, 'theme', ['warnings', 'templates']);
                            testTheme.active.should.be.true();
                            testTheme.warnings.should.be.an.Array();

                            done();
                        });
                });
        });
    });

    describe('error cases', function () {
        it('upload invalid theme', function (done) {
            scope.uploadTheme({themePath: path.join(__dirname, '/../../../utils/fixtures/themes/invalid.zip')})
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.statusCode.should.eql(422);
                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('ThemeValidationError');
                    res.body.errors[0].message.should.eql('Theme is not compatible or contains errors.');
                    done();
                });
        });

        it('upload casper.zip', function (done) {
            scope.uploadTheme({themePath: path.join(__dirname, '/../../../utils/fixtures/themes/casper.zip')})
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.statusCode.should.eql(422);
                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('ValidationError');
                    res.body.errors[0].message.should.eql('Please rename your zip, it\'s not allowed to override the default casper theme.');
                    done();
                });
        });

        it('activate "broken-theme" invalid theme', function (done) {
            request.put(localUtils.API.getApiQuery('themes/broken-theme/activate'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(422)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('ThemeValidationError');
                    res.body.errors[0].message.should.eql('Theme is not compatible or contains errors.');

                    done();
                });
        });

        it('activate non-existent theme', function (done) {
            request.put(localUtils.API.getApiQuery('themes/not-existent/activate'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(422)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('ValidationError');
                    res.body.errors[0].message.should.eql('not-existent cannot be activated because it is not currently installed.');

                    done();
                });
        });

        it('delete casper', function (done) {
            request.del(localUtils.API.getApiQuery('themes/casper'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(422)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('ValidationError');
                    res.body.errors[0].message.should.eql('Deleting the default casper theme is not allowed.');

                    done();
                });
        });

        it('delete non-existent theme', function (done) {
            request.del(localUtils.API.getApiQuery('themes/not-existent'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(404)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('NotFoundError');
                    res.body.errors[0].message.should.eql('Theme does not exist.');

                    done();
                });
        });

        it('delete active theme', function (done) {
            var jsonResponse, testTheme;
            // ensure test-theme is active
            request.put(localUtils.API.getApiQuery('themes/test-theme/activate'))
                .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                .expect(200)
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    jsonResponse = res.body;

                    testTheme = _.find(jsonResponse.themes, {name: 'test-theme'});
                    should.exist(testTheme);
                    localUtils.API.checkResponse(testTheme, 'theme', ['warnings', 'templates']);
                    testTheme.active.should.be.true();
                    testTheme.warnings.should.be.an.Array();

                    request.del(localUtils.API.getApiQuery('themes/test-theme'))
                        .set('Authorization', 'Bearer ' + scope.ownerAccessToken)
                        .expect(422)
                        .end(function (err, res) {
                            if (err) {
                                return done(err);
                            }

                            res.body.errors.length.should.eql(1);
                            res.body.errors[0].errorType.should.eql('ValidationError');
                            res.body.errors[0].message.should.eql('Deleting the active theme is not allowed.');

                            done();
                        });
                });
        });

        it('upload non application/zip', function (done) {
            scope.uploadTheme({themePath: path.join(__dirname, '/../../../utils/fixtures/csv/single-column-with-header.csv')})
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.statusCode.should.eql(415);
                    res.body.errors.length.should.eql(1);
                    res.body.errors[0].errorType.should.eql('UnsupportedMediaTypeError');
                    res.body.errors[0].message.should.eql('Please select a valid zip file.');

                    done();
                });
        });

        // @TODO: make this a nicer error!
        it.skip('upload different field name', function (done) {
            scope.uploadTheme({
                themePath: path.join(__dirname, '/../../../utils/fixtures/csv/single-column-with-header.csv'),
                fieldName: 'wrong'
            }).end(function (err, res) {
                if (err) {
                    return done(err);
                }

                res.statusCode.should.eql(500);
                res.body.errors[0].message.should.eql('Unexpected field');
                done();
            });
        });

        describe('As Editor', function () {
            it('can browse themes', function (done) {
                request.get(localUtils.API.getApiQuery('themes/'))
                    .set('Authorization', 'Bearer ' + scope.editorAccessToken)
                    .expect(200)
                    .end(function (err) {
                        if (err) {
                            return done(err);
                        }

                        done();
                    });
            });

            it('no permissions to upload theme', function (done) {
                scope.uploadTheme({
                    themePath: path.join(__dirname, '/../../../utils/fixtures/themes/valid.zip'),
                    accessToken: scope.editorAccessToken
                }).end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.statusCode.should.eql(403);

                    should.exist(res.body.errors);
                    res.body.errors.should.be.an.Array().with.lengthOf(1);
                    res.body.errors[0].errorType.should.eql('NoPermissionError');
                    res.body.errors[0].message.should.eql('You do not have permission to add themes');

                    done();
                });
            });

            it('no permissions to delete theme', function (done) {
                request.del(localUtils.API.getApiQuery('themes/test'))
                    .set('Authorization', 'Bearer ' + scope.editorAccessToken)
                    .expect(403)
                    .end(function (err, res) {
                        if (err) {
                            return done(err);
                        }

                        should.exist(res.body.errors);
                        res.body.errors.should.be.an.Array().with.lengthOf(1);
                        res.body.errors[0].errorType.should.eql('NoPermissionError');
                        res.body.errors[0].message.should.eql('You do not have permission to destroy themes');

                        done();
                    });
            });

            it('no permissions to download theme', function (done) {
                request.get(localUtils.API.getApiQuery('themes/casper/download/'))
                    .set('Authorization', 'Bearer ' + scope.editorAccessToken)
                    .expect(403)
                    .end(function (err, res) {
                        if (err) {
                            return done(err);
                        }

                        should.exist(res.body.errors);
                        res.body.errors.should.be.an.Array().with.lengthOf(1);
                        res.body.errors[0].errorType.should.eql('NoPermissionError');
                        res.body.errors[0].message.should.eql('You do not have permission to read themes');

                        done();
                    });
            });
        });

        describe('As Author', function () {
            it('can browse themes', function (done) {
                request.get(localUtils.API.getApiQuery('themes/'))
                    .set('Authorization', 'Bearer ' + scope.authorAccessToken)
                    .expect(200)
                    .end(function (err) {
                        if (err) {
                            return done(err);
                        }

                        done();
                    });
            });

            it('no permissions to upload theme', function (done) {
                scope.uploadTheme({
                    themePath: path.join(__dirname, '/../../../utils/fixtures/themes/valid.zip'),
                    accessToken: scope.authorAccessToken
                }).end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    res.statusCode.should.eql(403);

                    should.exist(res.body.errors);
                    res.body.errors.should.be.an.Array().with.lengthOf(1);
                    res.body.errors[0].errorType.should.eql('NoPermissionError');
                    res.body.errors[0].message.should.eql('You do not have permission to add themes');

                    done();
                });
            });

            it('no permissions to delete theme', function (done) {
                request.del(localUtils.API.getApiQuery('themes/test'))
                    .set('Authorization', 'Bearer ' + scope.authorAccessToken)
                    .expect(403)
                    .end(function (err, res) {
                        if (err) {
                            return done(err);
                        }

                        should.exist(res.body.errors);
                        res.body.errors.should.be.an.Array().with.lengthOf(1);
                        res.body.errors[0].errorType.should.eql('NoPermissionError');
                        res.body.errors[0].message.should.eql('You do not have permission to destroy themes');

                        done();
                    });
            });

            it('no permissions to download theme', function (done) {
                request.get(localUtils.API.getApiQuery('themes/casper/download/'))
                    .set('Authorization', 'Bearer ' + scope.authorAccessToken)
                    .expect(403)
                    .end(function (err, res) {
                        if (err) {
                            return done(err);
                        }

                        should.exist(res.body.errors);
                        res.body.errors.should.be.an.Array().with.lengthOf(1);
                        res.body.errors[0].errorType.should.eql('NoPermissionError');
                        res.body.errors[0].message.should.eql('You do not have permission to read themes');

                        done();
                    });
            });
        });
    });
});
