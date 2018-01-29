#!/usr/bin/env node

const _ = require('lodash')
const fs = require('fs-extra')
const spawnSync = require('child_process').spawnSync
const yaml = require('js-yaml')
const path = require('path')
const meow = require('meow')
const scp = require('scp2')
const ssh = require('ssh2')
const temp = require('temp')
const dirPath = temp.mkdirSync('deployMeteorBuild')
const argv = meow({
  description: false,
  help: 'deployMeteor  [--source=./] [--config=./.deployMeteor.{json|yaml} [--config=/otherDeployConfiguration]]'
}, {
  default: {
    source: './',
    config: './.deployMeteor.yaml'
  },
  string: ['source', 'config', 'docker', 'sleep']
})
const targz = require('tar.gz')

const ssheasy = function (where, what, options, callback) {
  callback = callback || options
  var sshClient = new ssh.Client()
  var err = []
  var data = []
  var i = 0
  if (!Array.isArray(what)) {
    what = [what]
  }

  var helper = function () {
    i++
    var command = what.shift()
    if (!command) {
      sshClient.end()
      return callback(null, {data: data, err: err})
    }
    sshClient.exec(command, function (error, stream) {
      if (error) {
        sshClient.end()
        // eslint-disable-next-line
        callback({line: i, command: command, err: err})
        callback = function () {}
        return
      }
      stream.on('close', function (code, signal) {
        if (!err.length || options.onErrorContinue) {
          return helper()
        }
        sshClient.end()
        // eslint-disable-next-line
        callback({line: i, command: command, commands: what, err: err, data: data})
        callback = function () {}
      }).on('data', function (response) {
        data.push(response.toString())
      }).stderr.on('data', function (response) {
        err.push(response.toString())
      })
    })
  }

  sshClient.on('ready', function () {
    helper(sshClient, what, err, data, callback)
  })
  sshClient.on('error', function (err) {
    sshClient.end()
    callback(err || true)
    callback = function () {}
  })
  sshClient.connect(where)
}
const enviromentalize = function (config) {
  if (!config.settings) {
    return
  }
  if (typeof config.settings === 'string') {
    config.settings = fs.readJsonSync(config.settings)
    return enviromentalize(config)
  }
  config.settings = JSON.stringify(config.settings).replace(/\\/g, '\\\\\\\\').replace(/"/g, '\\"').replace(/'/g, "\\\\\\'").replace(/{/g, '\\{')
  return config
}
const assert = function (bool, message) {
  if (bool) {
    return
  }
  console.log(message)
  argv.showHelp()
}

// scp.on('transfer', function (buffer, uploaded, total) {
//   console.log(uploaded, total)
// })

const expandConfigPorts = function (config) {
  var response = []
  if (!Array.isArray(config.port)) {
    return [config]
  }
  config.port.forEach(function (port) {
    var c = Object.assign({}, config)
    c.port = port
    response.push(c)
  })
  return response
}

temp.track()

if (typeof argv.flags.source === 'object') {
  console.log('ERROR: \n  Only one --source parameter')
  argv.showHelp()
}

const compilar = function (options) {
  console.log('building to', options.to)
  spawnSync('meteor', ['build', '--server-only', '--directory', options.to, '--architecture', 'os.linux.x86_64'], {cwd: options.from, stdio: [0, 1, 2], encoding: 'utf8'})
  comprimir(options)
}

const comprimir = function (options) {
  console.log('compressing')
  targz().compress(path.join(options.to, 'bundle'), path.join(options.to, 'bundle.tar.gz'), function (err) {
    assert(!err, err)
    checkConfig(prepararConfigs(argv.flags.config))
  })
}

const prepararConfigs = function (configs) {
  if (typeof configs === 'string') {
    configs = [configs]
  }
  return expandConfigHosts(
    expandConfigSSHs(
      configs.map(cargarConfig)
    )
  )
}

const cargarConfig = function (config) {
  if (config.match(/\.json$/)) {
    try {
      return enviromentalize(fs.readJsonSync(config))
    } catch (e) {
      assert(false, 'ERROR:\n  ', config, 'cannot be parsed or opened')
    }
  }
  if (config.match(/\.y(a?)ml$/)) {
    try {
      return enviromentalize(yaml.safeLoad(fs.readFileSync(config, 'utf8')))
    } catch (e) {
      assert(false, 'ERROR:\n  ', config, 'cannot be parsed or opened')
    }
  }
  if (config.match(/\.js$/)) {
    try {
      config = require(config)
      return enviromentalize(config.config || config.callable(argv.flags))
    } catch (e) {
      assert(false, 'ERROR:\n  ', config, 'cannot be required or error in js')
    }
  }
  assert(false, 'ERROR: \n', config, 'should be .json .yaml or .yml')
}

const expandConfigSSHs = function (configs) {
  var response = []
  configs.forEach(function (config) {
    if (!Array.isArray(config.ssh)) {
      response.push(config)
      return
    }
    config.ssh.forEach(function (ssh) {
      config = _.cloneDeep(config)
      config.ssh = ssh
      response.push(config)
    })
  })
  return response
}

const expandConfigHosts = function (configs) {
  var response = []
  configs.forEach(function (config) {
    var c = JSON.parse(JSON.stringify(config))
    if (c.ssh.privateKey) {
      c.ssh.privateKey = fs.readFileSync(c.ssh.privateKey, 'utf8')
    } else {
    }
    if (c.ssh.host.toLowerCase) {
      response.push(c)
      return
    }
    c.ssh.host.forEach(function (host) {
      var d = JSON.parse(JSON.stringify(c))
      d.ssh.host = host
      response.push(d)
    })
  })
  return response
}

const checkConfig = function (configs) {
  configs.forEach(function (config, i) {
    console.log('', i, ': checking config')
    if (!config.path) {
      console.log('path missing')
    }
    if (!config.ssh) {
      console.log('ssh missing')
    }
    if (config.path && config.ssh) {
      checkSSH(config, i)
    }
  })
}

const checkSSH = function (config, i) {
  console.log('', i, ': checking server')
  ssheasy(config.ssh, [
    'cd ' + config.path,
    'touch ' + path.join(config.path, 'testWritable'),
    'rm ' + path.join(config.path, 'testWritable'),
    'docker pull ' + config.docker
  ], function (err, data) {
    if (err) {
      return console.log('', i, ': error in server\'s checks', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
    }
    backup(config, i)
  })
}

const backup = function (config, i) {
  var from = path.join(config.path, config.name)
  var to = path.join(config.path, config.name) + '.backup'

  console.log('', i, ': backuping')

  ssheasy(config.ssh, [
    'rm -r -f ' + to,
    'test -d ' + from + '&& mv ' + from + ' ' + to,
    'mkdir ' + from
  ], function (err, data) {
    if (err) {
      return console.log('', i, ': error backuping', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
    }
    upload(config, i)
  })
}

const upload = function (config, i) {
  console.log('', i, ': uploading')
  config.ssh.path = path.join(config.path, config.name)
  scp.scp(path.join(dirPath, 'bundle.tar.gz'), config.ssh, function (err, data) {
    if (err) {
      return console.log('', i, ': error uploading', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
    }
    untar(config, i)
  })
}

const untar = function (config, i) {
  var to = path.join(config.path, config.name)

  console.log('', i, ': uncompressing')

  ssheasy(config.ssh, [
    'cd ' + to + '; tar -zxvf bundle.tar.gz; rm bundle.tar.gz'
  ], function (err, data) {
    if (err) {
      return console.log('', i, ': error uncompressing', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
    }
    createScripts(config, i)
  })
}

const createScripts = function (config, i) {
  expandConfigPorts(config).forEach(function (config, index) {
    console.log('', i, config.port, ': creating scripts for port')
    var name = config.name + '.' + config.port
    ssheasy(config.ssh, [
      'echo docker run -d --restart=always --net=host --name ' + name +
      ' -v \\$bundle:/meteor' +
      ' -e ROOT_URL=' + config.root +
      ' -e MONGO_URL=\\"' + config.mongo.mongodb + '\\"' +
      ' -e PORT=' + config.port +
      (config.forwarded !== undefined ? ' -e HTTP_FORWARDED_COUNT=' + config.forwarded : '') +
      (config.mongo.oplog ? ' -e MONGO_OPLOG_URL=\\"' + config.mongo.oplog + '\\"' : '') +
      (config.bind ? ' -e BIND_IP=' + config.bind : '') +
      (config.settings ? " -e METEOR_SETTINGS=\\'" + config.settings + "\\'" : '') +
      ' ' + config.docker + ' > ' + path.join(config.path, config.name, 'start.' + config.port + '.sh'),
      'echo "docker stop ' + name + '; docker rm ' + name + '" > ' + path.join(config.path, config.name, 'stop.' + config.port + '.sh'),
      'chmod u+x ' + path.join(config.path, config.name, '*.sh')
    ], function (err, data) {
      if (err) {
        return console.log('', i, config.port, ': error creating scripts', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
      }
      console.log('', i, config.port, ': waiting', (i + index) * config.checktimes * config.checkseconds, 'seconds to lauch')
      setTimeout(function () {
        launch(config, i)
      }, (i + index) * config.checktimes * config.checkseconds * 1000)
    })
  })
}

const launch = function (config, i) {
  console.log('', i, config.port, ': launching')
  ssheasy(config.ssh, [
    'test -e ' + path.join(config.path, config.name + '.backup', 'stop.' + config.port + '.sh') +
      ' && ' + path.join(config.path, config.name + '.backup', 'stop.' + config.port + '.sh'),
    'bundle=' + path.join(config.path, config.name, 'bundle') + ' ' + path.join(config.path, config.name, 'start.' + config.port + '.sh') +
      ' || bundle=' + path.join(config.path, config.name + '.backup', 'bundle') + ' ' + path.join(config.path, config.name + '.backup', 'start.' + config.port + '.sh')
  ], function (err) {
    if (err) {
      console.log('', i, config.port, ': error launching', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
      return restoring(config, i)
    }
    config.checktimes = config.checktimes || 10
    config.checkseconds = config.checkseconds || 6
    console.log('', i, config.port, ': checking ', config.checktimes, 'times, waiting', config.checkseconds, 'seconds each time.')
    setTimeout(function () {
      checkContainer(config, i, config.checktimes + 1)
    }, config.checkseconds * 1000)
  })
}

const checkContainer = function (config, i, times) {
  if (!times) {
    console.log('', i, config.port, 'Container failed, launching backup')
    return restoring(config, i)
  }
  console.log('', i, config.port, config.checktimes + 1 - times, ': check')
  var bind = '127.0.0.1'
  if (config.bind && config.bind !== '0.0.0.0') {
    bind = config.bind
  }
  ssheasy(config.ssh, 'curl -s -S -I -X GET ' + bind + ':' + config.port, function (err, data) {
    if (err) {
      console.log('', i, config.port, config.checktimes + 1 - times, ': check failed')
      return setTimeout(function () {
        checkContainer(config, i, times - 1)
      }, (config.checkseconds * 1000) || 6)
    }
    console.log('', i, config.port, config.checktimes + 1 - times, ': check success')
  })
}

const restoring = function (config, i) {
  console.log('', i, config.port, ': restoring')
  return ssheasy(config.ssh, [
    'docker stop ' + config.name + '.' + config.port,
    'docker rm ' + config.name + '.' + config.port,
    'test -e ' + path.join(config.path, config.name + '.backup', 'start.' + config.port + '.sh') +
      ' && bundle=' + path.join(config.path, config.name + '.backup', 'bundle') + ' ' + path.join(config.path, config.name + '.backup', 'start.' + config.port + '.sh')
  ], function (err) {
    if (err) {
      return console.log('', i, config.port, ': error restoring', '\n', yaml.safeDump(config), '\n', yaml.safeDump(err))
    }
    console.log('', i, config.port, ': restored')
  })
}

compilar({from: argv.flags.source, to: dirPath})
