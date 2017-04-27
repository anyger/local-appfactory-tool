#!/usr/bin/env node

'use strict';

var program = require('commander');
var fs = require('fs');
var url = require('url');
var http = require('http');
var request = require('request');
var path = require('path');
var AdmZip = require('adm-zip');
var Q = require('q');
var child_process = require('child_process');

program
    .command('install')
    .description('download nd android project')
    .action(function () {
        isConfigValid();

        let project_download_url = 'http://10005015:abc123456@jenkins.cc.service.sdp.nd/job/fac-fun-android_main_component1471248842292/ws/*zip*/fac-fun-android_main_component1471248842292.zip';
        let project_zip_name = url.parse(project_download_url).pathname.split('/').pop();

        request
            .get(project_download_url)
            .on('response', function (response) {
                if (response.statusCode != 200) {
                    console.log('request failed : ' + project_download_url);
                } else {
                    console.log('start downloading project, please wait...');
                    response.pipe(fs.createWriteStream(project_zip_name));
                }
            })
            .on('complete', function (complete) {
                console.log('request complete.');
                // whether downloaded zip file exists
                if (fs.existsSync("./" + project_zip_name)) {
                    // reading archives
                    let zip = new AdmZip("./" + project_zip_name);
                    zip.extractAllTo("./", true);

                    // rename directory
                    let project_dir_name = project_zip_name.split('.').shift();
                    fs.renameSync("./" + project_dir_name, './project');

                    importComponent();
                } else {
                    console.log('the downloaded project zip file do not exists!');
                }
            });
    });

function isConfigValid() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync('./config.json'));
    } catch (ex) {
        throw new Error('the config.json is invalid!');
    }

    if (!isStrNull(config.local_src_path)) {
        if (isStrNull(config.exclude)) {
            throw new Error('the config.exclude is null!!!');
        }
        if (isStrNull(config.class)) {
            throw new Error('the config.class is null!!!');
        }
        if (isStrNull(config.name)) {
            throw new Error('the config.name is null!!!');
        }
        if (isStrNull(config.namespace)) {
            throw new Error('the config.namespace is null!!!');
        }
        if (config.event == null) {
            throw new Error('the config.event is null!!!');
        }
        if (config.properties == null) {
            throw new Error('the config.properties is null!!!');
        }
    }
}

/**
 * 导入组件代码
 * 
 */
function importComponent() {
    // make component dir
    fs.mkdirSync('./project/lib_component');

    let config = JSON.parse(fs.readFileSync('./config.json'));
    if (!isStrNull(config.local_src_path)) {
        console.log('local_src_path : ' + config.local_src_path);
        copy(config.local_src_path, './project/lib_component');
        setConfig(config);
        done();
    } else {
        console.log('local_src_path is null,import the default component.');
        downloadDefaultComponent()
            .then(data => {
                copy(data.src, data.dst);
                setConfig(config);
                done();
            })
            .fail(console.error);
    }
}

/**
 * 下载默认组件代码
 * 
 */
function downloadDefaultComponent() {
    var deferred = Q.defer();

    let default_component_url = 'http://git.sdp.nd/326912/test-project/repository/archive.zip?ref=master';
    let default_component_zip_name = url.parse(default_component_url).pathname.split('/').pop();

    request
        .get(default_component_url)
        .on('response', function (response) {
            if (response.statusCode != 200) {
                console.log('request failed : ' + default_component_url);
            } else {
                console.log('start downloading the default component, please wait...');
                response.pipe(fs.createWriteStream(default_component_zip_name));
            }
        })
        .on('complete', function (complete) {
            console.log('request complete.');
            // 虽然已经采用了异步方法，但是默认组件的压缩包文件太小，并且I/O操作本身也会耗费较多时间，所以这里不得不用定时器等待几秒
            setTimeout(function () {
                if (fs.existsSync('./' + default_component_zip_name)) {
                    // reading archives
                    let zip = new AdmZip('./' + default_component_zip_name);
                    zip.extractAllTo('./component/', true);

                    // rename directory
                    let default_component_dir_name = fs.readdirSync('./component/');
                    fs.renameSync('./component/' + default_component_dir_name, './default_component');

                    // remove tmp dir
                    fs.rmdirSync('./component/');

                    deferred.resolve(JSON.parse('{"src":"./default_component/module", "dst":"./project/lib_component"}'));
                } else {
                    deferred.reject('the downloaded component zip file do not exists!');
                }
            }, 2000);

        });

    return deferred.promise;
}

/**
 * 复制目录中的所有文件包括子目录
 * 
 * @param {String} src 原文件路径
 * @param {String} dst 目标文件路径
 */
function copy(src, dst) {
    // 将组件代码复制到project目录下
    let srcDirs = fs.readdirSync(src);
    let _src, _dst, readable, writable;
    srcDirs.forEach(function (path) {
        _src = src + '/' + path;
        _dst = dst + '/' + path;

        let stat = fs.statSync(_src);
        if (stat.isFile()) {
            // 创建读取流
            readable = fs.createReadStream(_src);
            // 创建写入流
            writable = fs.createWriteStream(_dst);
            // 通过管道来传输流
            readable.pipe(writable);
        } else if (stat.isDirectory()) {
            // 如果是目录则递归调用自身
            exists(_src, _dst, copy);
        }
    });
}

/**
 * 判断文件是否存在，并调用 callback
 * 
 * @param {any} src 原文件路径
 * @param {any} dst 目标文件路径
 * @param {any} callback 回调函数
 */
function exists(src, dst, callback) {
    let exists = fs.existsSync(dst);
    if (!exists) {
        fs.mkdirSync(dst);
    }
    callback(src, dst);
}

/**
 * 设置配置属性
 * 
 * @param {any} config 配置文件json对象
 */
function setConfig(config) {
    console.log('set config to project...');
    if (config == null) {
        throw new Error('config is null!');
    }

    let isDefault = isStrNull(config.local_src_path);

    let settings = '\ninclude \':lib_component\'\n';
    fs.appendFileSync('./project/settings.gradle', settings);

    let dependency;
    if (isDefault) {
        dependency = '\ndependencies{compile project(":lib_component")}\n';
    } else {
        dependency = '\ndependencies{compile project(":lib_component")}\nandroid{configurations{' + config.exclude + '}}\n';
    }
    fs.appendFileSync('./project/app/app-factory-component.gradle', dependency);

    let announce;
    if (isDefault) {
        announce = '{"android": "com.nd.sdp.LocalComponent","component": {"name": "local-default-component","namespace": "com.nd.sdp"},"ios": ""}';
    } else {
        announce = '{"android": "' + config.class + '","component": {"name": "' + config.name + '","namespace": "' + config.namespace + '"},"ios": ""}';
    }
    let annouceSrc = JSON.parse(fs.readFileSync('./project/app/assets/app_factory/app/announce.json'));
    annouceSrc.native.push(JSON.parse(announce));
    fs.writeFileSync('./project/app/assets/app_factory/app/announce.json', JSON.stringify(annouceSrc));

    let components;
    if (isDefault) {
        components = '{"component": {"name": "local-default-component","namespace": "com.nd.sdp"},"native-android": {"class": "com.nd.sdp.LocalComponent"},"native-ios": {"class": ""},"type": ["native-ios","native-android"]}';
    } else {
        components = '{"component": {"name": "' + config.name + '","namespace": "' + config.namespace + '"},"native-android": {"class": "' + config.class + '"},"native-ios": {"class": ""},"type": ["native-ios","native-android"]}';
    }
    let componentsSrc = JSON.parse(fs.readFileSync('./project/app/assets/app_factory/app/components.json'));
    componentsSrc.push(JSON.parse(components));
    fs.writeFileSync('./project/app/assets/app_factory/app/components.json', JSON.stringify(componentsSrc));

    let biz_env;
    if (isDefault) {
        biz_env = '{"component": {"namespace": "com.nd.sdp","name": "local-default-component"},"env": "8","__namespace": "com.nd.sdp.local-default-component"}';
    } else {
        biz_env = '{"component": {"namespace": "' + config.namespace + '","name": "' + config.name + '"},"env": "8","__namespace": "' + config.namespace + '.' + config.name + '"}';
    }
    let biz_env_Src = JSON.parse(fs.readFileSync('./project/app/assets/app_factory/zh-CN/components/biz_env.json'));
    biz_env_Src.push(JSON.parse(biz_env));
    fs.writeFileSync('./project/app/assets/app_factory/zh-CN/components/biz_env.json', JSON.stringify(biz_env_Src));

    let build;
    if (isDefault) {
        build = '{"component": {"name": "local-default-component","namespace": "com.nd.sdp"},"event": {},"properties": {},"version": "release"}';
    } else {
        build = '{"component": {"name": "' + config.name + '","namespace": "' + config.namespace + '"},"event": ' + JSON.stringify(config.event) + ',"properties": ' + JSON.stringify(config.properties) + ',"version": "release"}';
    }
    let buildSrc = JSON.parse(fs.readFileSync('./project/app/assets/app_factory/zh-CN/components/build.json'));
    buildSrc.push(JSON.parse(build));
    fs.writeFileSync('./project/app/assets/app_factory/zh-CN/components/build.json', JSON.stringify(buildSrc));
}

function isStrNull(str) {
    return str == null || str == undefined || str.trim() == '';
}

function done() {
    console.log('localization complete,open the project with your IDE.');
}


program
    .command('list')//声明hi下有一个命令叫list
    .description('list files in current working directory')//给出list这个命令的描述
    .option('-a, --all', 'Whether to display hidden files')//设置list这个命令的参数
    .action(function (options) {//list命令的实现体
        var fs = require('fs');
        //获取当前运行目录下的文件信息
        fs.readdir(process.cwd(), function (err, files) {
            var list = files;
            if (!options.all) {//检查用户是否给了--all或者-a的参数，如果没有，则过滤掉那些以.开头的文件
                list = files.filter(function (file) {
                    return file.indexOf('.') !== 0;
                });
            }
            console.log(list.join(' '));//控制台将所有文件名打印出来
        });
    });

program
    .command('test')
    .description('test')
    .action(function () {
        child_process.execFile('D:/JsProjects/local-appfactory-demo/install.bat', null, { cwd: 'D:/' }, function (error, stdout, stderr) {
            if (error !== null) {
                console.log('exec error: ' + error);
            }
            else console.log('成功执行指令!');
        });
    });

program.parse(process.argv);//开始解析用户输入的命令
