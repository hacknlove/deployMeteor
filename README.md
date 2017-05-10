# DeployMeteor

    npm install -g deploymeteor

    deployMeteor [--source=./] [--config=./.deployMeteor.yaml [--config=/foo/bar/.{json|yaml}]]

## What does it do?

* build the meteor app `--source=./` *default to current directory*
* compress the bundle
* check the configuration
* check some basic requirements on the servers *(can connect, can write, has docker)*
* on each server:
  * pull the docker image (`docker`)
  * backup previous version (`{{path}}/{{name}}.backup`)
  * upload the compressed bundle to (`{{path}}/{{name}}`)
  * uncompress the bundle
  * create some start and stop scripts (`{{path}}/{{name}}/start.{{port}}.js`) `{{path}}/{{name}}/stop.{{port}}.sh`)
  * if (`port`) is an array
    * it does the next steps, once for each port, delaying `checktimes*checkseconds` each
  * stop previous version
  * lauch current version
  * check that it is working in the ip (`bind`) and port (`port`) indicated, (`checktimes`) times maximun, delaying (`checkseconds`) each.
  * If no one check is successfull:
    * stop current version
    * lauch previous version

## .deployMeteor.yaml

### Simple

    root: http://example.com
    path: /folder/to/be/deployed/in/the/servers
    name: myMeteorAppName
    port: 8080
    mongo:
      mongodb: mongodb://host1,host2,host3/database?replicaSet=yourReplicaSetName
      oplog: mongodb://host1,host2,host3/local?replicaSet=yourReplicaSetName
    ssh:
      host: yourHost.com
      username: username
      privateKey: /home/user/.ssh/id_rsa

### Full

    root: http://example.com
    path: /folder/to/be/deployed/in/the/servers
    name: myMeteorAppName
    port: [8080, 8090]
    bind: 127.0.0.1
    settings: ./production.settings.json
    forwarded: 1
    checktimes: 10
    checkseconds: 6
    docker: 'pykiss/simple-meteor'
    mongo:
      mongodb: mongodb://host1,host2,host3/database?replicaSet=yourReplicaSetName
      oplog: mongodb://host1,host2,host3/local?replicaSet=yourReplicaSetName
    ssh:
      - host: yourHost.com
        username: username
        privateKey: /home/user/.ssh/id_rsa
      - host: yourOtherHost.com
        port: 2222
        username: OtherUsername
        password: password
      - host: [somehos.ts, 'withwqu.al, Credentia.ls]
        username: username
        password: password


## you can use json with `--config=.../foo.json`

    {
      "root": "http://example.com",
      "path": "/folder/to/be/deployed/in/the/servers",
      "name": "myMeteorAppName",
      "port": [
        8080,
        8090
      ],
      "bind": "127.0.0.1",
      "settings": "./production.settings.json",
      "forwarded": 1,
      "checktimes": 10,
      "checkseconds": 6,
      "docker": "pykiss/simple-meteor",
      "mongo": {
        "mongodb": "mongodb://host1,host2,host3/database?replicaSet=yourReplicaSetName",
        "oplog": "mongodb://host1,host2,host3/local?replicaSet=yourReplicaSetName"
      },
      "ssh": [
        {
          "host": "yourHost.com",
          "username": "username",
          "privateKey": "/home/user/.ssh/id_rsa"
        },
        {
          "host": "yourOtherHost.com",
          "port": 2222,
          "username": "OtherUsername",
          "password": "password"
        },
        {
          "host": [
            "somehos.ts",
            "withwqu.al",
            "Credentia.ls"
          ],
          "username": "username",
          "password": "password"
        }
      ]
    }

## Please, Helpme to improve the documentation

thanks
