/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

PageSetupServer.prototype = {
    _init: function() {
        this.id = "dashboard_setup_server_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Setup Server");
    },

    show: function() {
    },

    leave: function() {
    },

    enter: function(first_visit) {
        var me = this;

        if (first_visit) {
            $('#dashboard_setup_cancel').on('click', $.proxy(this, 'cancel'));
            $('#dashboard_setup_next').on('click', $.proxy(this, 'next'));
        }

        me.client = null;
        me.address = PageSetupServer.address;

        $('#dashboard_setup_login_user').val("");
        $('#dashboard_setup_login_password').val("");
        $('#dashboard_setup_login_error').text("");

        this.show_tab ('login');
    },

    show_tab: function(tab) {
        $('.cockpit-setup-tab').hide();
        if (tab == 'login') {
            $('#dashboard_setup_login_tab').show();
            $('#dashboard_setup_next').text(_("Login"));
            $('#dashboard_setup_next').button('refresh');
            this.next_action = this.next_login;
        } else if (tab == 'no-agent') {
            $('#dashboard_setup_no_agent_tab').show();
            $('#dashboard_setup_next').text(_("Retry"));
            $('#dashboard_setup_next').button('refresh');
            this.next_action = this.next_login;
        } else if (tab == 'confirm') {
            $('#dashboard_setup_confirm_tab').show();
            $('#dashboard_setup_next').text(_("Setup"));
            $('#dashboard_setup_next').button('refresh');
            this.next_action = this.next_setup;
        } else if (tab == 'setup') {
            $('#dashboard_setup_setup_tab').show();
            $('#dashboard_setup_next').text(_("..."));
            $('#dashboard_setup_next').button('refresh');
            $('#dashboard_setup_next').button('disable');
            this.next_action = null;
        } else if (tab == 'no_setup') {
            $('#dashboard_setup_no_setup_tab').show();
            $('#dashboard_setup_next').text(_("Close"));
            $('#dashboard_setup_next').button('refresh');
            this.next_action = this.next_close;
        }
    },

    close: function() {
        if (this.client)
            this.client.close ("cancelled");
        $("#dashboard_setup_server_dialog").popup('close');
    },

    cancel: function() {
        this.close();
    },

    next: function() {
        this.next_action();
    },

    next_login: function() {
        var me = this;

        var user = $('#dashboard_setup_login_user').val();
        var pass = $('#dashboard_setup_login_password').val();

        $('#dashboard_setup_login_error').text("");

        me.client = new DBusClient (me.address, user + "\n" + pass);
        $(me.client).on('state-change', function () {
            if (me.client.state == "closed") {
                if (me.client.error == "no-agent")
                    me.show_tab("no-agent");
                else if (me.client.error) {
                    $('#dashboard_setup_login_error').text(cockpit_client_error_description (me.client.error));
                    me.show_tab('login');
                }
            } else if (me.client.state == "ready") {
                me.prepare_setup();
            }
        });
    },

    prepare_setup: function () {

        function get_role_accounts (client, roles) {
            var i;
            var accounts = client.getInterfacesFrom("/com/redhat/Cockpit/Accounts/",
                                                    "com.redhat.Cockpit.Account");
            var map = { };

            function groups_contain_roles (groups) {
                for (var i = 0; i < roles.length; i++) {
                    if (cockpit_find_in_array (groups, roles[i][0]))
                        return true;
                }
                return false;
            }

            for (i = 0; i < accounts.length; i++) {
                if (roles === null || groups_contain_roles (accounts[i].Groups))
                    map[accounts[i].UserName] = accounts[i];
            }
            return map;
        }

        var manager = cockpit_dbus_local_client.lookup ("/com/redhat/Cockpit/Accounts",
                                                        "com.redhat.Cockpit.Accounts");
        var local = get_role_accounts (cockpit_dbus_local_client, manager.Roles);
        var remote = get_role_accounts (this.client, null);

        function needs_update (l) {
            // XXX
            return true;
        }

        var to_update = [ ];
        for (var l in local) {
            if (needs_update (l))
                to_update.push(local[l]);
        }

        this.to_update = to_update;

        if (to_update.length > 0) {
            $('#dashboard_setup_names').empty();
            for (var i = 0; i < to_update.length; i++) {
                $('#dashboard_setup_names').append($('<div/>').text(to_update[i].UserName));
            }
            this.show_tab('confirm');
        } else {
            this.show_tab('no_setup');
        }
    },

    next_setup: function() {
        var me = this;
        var had_errors;
        var cur_status_is_tmp;

        function clear_status() {
            $('#dashboard_setup_status').empty();
            had_errors = false;
            cur_status_is_tmp = false;
        }

        function end_status() {
            if (cur_status_is_tmp)
                $($('#dashboard_setup_status')[0].lastChild).remove();
        }

        function append_status(msg, attrs, tmp) {
            if (cur_status_is_tmp)
                $($('#dashboard_setup_status')[0].lastChild).remove();
            $('#dashboard_setup_status').append($('<p/>', attrs || {}).text(msg));
            cur_status_is_tmp = tmp;
        }

        function status(msg) {
            append_status(msg, { }, false);
        }

        function progress(msg) {
            append_status(msg, { }, true);
        }

        function log_error(msg) {
            append_status (msg, { style: "color:red" }, false);
            had_errors = true;
        }

        function update_account (templ, return_cont) {

            var acc;

            function std_cont (func) {
                return function (error, result) {
                    if (error) {
                        log_error(error.message);
                        return_cont ();
                    } else {
                        func (result);
                    }
                };
            }

            function create () {
                var accounts = me.client.getInterfacesFrom("/com/redhat/Cockpit/Accounts",
                                                           "com.redhat.Cockpit.Account");

                for (var i = 0; i < accounts.length; i++) {
                    if (accounts[i].UserName == templ.UserName) {
                        status("Updating " + templ.UserName);
                        acc = accounts[i];
                        set_groups ();
                        return;
                    }
                }

                status("Creating " + templ.UserName);
                var manager = me.client.lookup ("/com/redhat/Cockpit/Accounts",
                                                "com.redhat.Cockpit.Accounts");
                manager.call("CreateAccount",
                             templ.UserName,
                             templ.RealName,
                             "",
                             false,
                             std_cont (set_groups_path));
            }

            function set_groups_path (path) {
                acc = me.client.lookup (path, "com.redhat.Cockpit.Account");
                if (!acc) {
                    log_error("Account object not found");
                    return_cont ();
                    return;
                }

                set_groups ();
            }

            function set_groups () {
                // XXX - filter out non-role groups and groups that
                //       don't exist on the target
                progress ("Adding " + acc.UserName + " to groups " + templ.Groups.toString());
                acc.call('ChangeGroups', templ.Groups, [ ],
                         std_cont (get_avatar));
            }

            function get_avatar () {
                progress("Setting avatar for " + acc.UserName);
                templ.call('GetIconDataURL',
                           std_cont (set_avatar));
            }

            function set_avatar (dataurl) {
                if (dataurl) {
                    acc.call('SetIconDataURL', dataurl,
                             std_cont (get_password_hash));
                } else
                    get_password_hash ();
            }

            function get_password_hash () {
                progress("Setting password for " + acc.UserName);
                templ.call('GetPasswordHash',
                           std_cont (set_password_hash));
            }

            function set_password_hash (hash) {
                acc.call('SetPasswordHash', hash,
                         std_cont (return_cont));
            }

            create ();
        }

        function update_accounts (i) {
            if (i < me.to_update.length) {
                update_account (me.to_update[i],
                                function () {
                                    update_accounts (i+1);
                                });
            } else {
                end_status ();
                if (had_errors) {
                    $('#dashboard_setup_next').text(_("Retry"));
                    $('#dashboard_setup_next').button('refresh');
                    $('#dashboard_setup_next').button('enable');
                    me.next_action = me.next_setup;
                } else {
                    $('#dashboard_setup_next').text(_("Close"));
                    $('#dashboard_setup_next').button('refresh');
                    $('#dashboard_setup_next').button('enable');
                    me.next_action = me.next_close;
                }
            }
        }

        clear_status();
        this.show_tab('setup');

        update_accounts (0);
    },

    next_close: function () {
        this.close();
    }

};

function PageSetupServer() {
    this._init();
}

cockpit_pages.push(new PageSetupServer());

function cockpit_setup_server (address) {
    PageSetupServer.address = address;
    $("#dashboard_setup_server_dialog").popup('open');
}
