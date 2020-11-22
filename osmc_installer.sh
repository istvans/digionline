#!/bin/bash

set -euxo pipefail  # safe

sudo -v
if [ $? -ne 0 ]; then
    echo "Nincs meg a szukseges sudo hozzaferes!" >&2
    exit 1
fi

echo "DIGIOnline servlet telepito (v2) indul...";

sudo apt-get update
curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
sudo apt-get install -y cron nodejs npm wget
sudo npm install typescript -g

DIGI_DIR=$HOME/digionline
ask_add_remote=false
if [ ! -d $DIGI_DIR ]; then
    git clone https://github.com/szabbenjamin/digionline $DIGI_DIR
else
    echo "A mar meglevo $DIGI_DIR konyvtart hasznaljuk."
    ask_add_remote=true
fi
cd $DIGI_DIR

if [[ $ask_add_remote && ( ! $(git remote | fgrep upstream) ) ]]; then
    ADD_REMOTE_CMD="git remote add upstream https://github.com/szabbenjamin/digionline.git"
    read -rep "Hozzaadjuk az upstream-et [opcionalis!]? (i/n) " ANSWER
    if [[ ${ANSWER,,} =~ ^i$ ]]; then
        $ADD_REMOTE_CMD
        git fetch upstream
        echo "Kesz"
    else
        echo "OK. Kihagytuk ezt a lepest."
    fi
fi

echo "Service beallitasanak elokeszitese..."
DIGI_LOG=/var/log/digionline.log
DIGI_SCRIPT=digionline.sh
cat > $DIGI_SCRIPT <<EOL
#!/bin/bash
set -euxo pipefail  # safe
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd $DIGI_DIR
DIGI_LOG=$DIGI_LOG
mv $DIGI_LOG ${DIGI_LOG}.1 || true
echo "Log: $DIGI_LOG"
npm start >$DIGI_LOG 2>&1
EOL
chmod 755 $DIGI_SCRIPT

npm install
touch epg.xml

if [ ! -f config.ts ]; then
    cp config.sample.ts config.ts
    echo "Add meg bejelentkezesi adataidat..."
    sleep 5
    if [[ -z "${EDITOR:-}" ]]; then
        EDITOR=nano
    fi
    $EDITOR config.ts
else
    echo "A mar meglevo config-ot hasznaljuk."
fi

cat > digionline.service <<EOL
[Unit]
Description=digionline servlet app

[Service]
ExecStart=$DIGI_DIR/$DIGI_SCRIPT
Restart=always
User=root
Group=root
Environment=PATH=/usr/bin:/usr/local/bin
Environment=NODE_ENV=production
WorkingDirectory=$DIGI_DIR

[Install]
WantedBy=multi-user.target
EOL

printf "Forditas... "
tsc main.ts
echo kesz

printf "Service indul... "
sudo cp digionline.service /etc/systemd/system
sudo systemctl daemon-reload
sudo systemctl restart digionline
sudo systemctl enable digionline
echo kesz

echo "Crontab ellenorzes..."
if $(crontab -l | grep -P "digionline[ ]+restart" >/dev/null 2>&1); then
    crontab -l
    echo kesz
else
    echo "Crontab konfiguralas a logfile meretenek limitalasara..."
    DIGI_CRON=/tmp/digi.cron
    cat > $DIGI_CRON <<EOL
# to ensure digionline logs cannot grow forever
0 5 * * mon     /usr/sbin/service digionline restart
EOL
    CRONTAB_CMD="crontab $DIGI_CRON"
    echo "'$CRONTAB_CMD'"
    cat $DIGI_CRON

    read -rep "Menthetem az uj crontab-ot? Az eredeti crontab-rol biztonsagi masolat keszul. (i/n) " ANSWER
    if [[ ${ANSWER,,} =~ ^i$ ]]; then
        ORIG_CRON=/tmp/orig.cron
        crontab -l > $ORIG_CRON
        $CRONTAB_CMD
        echo "Kesz. Az eredeti crontab-ot ide masoltam: $ORIG_CRON"
    else
        echo "Nem frissitettuk a crontab-ot."
    fi
fi

echo "A service keszen all a hasznalatra. less $DIGI_LOG; ha erdekel az allapota"
