import dns from 'dns';

// Mobile-hotspot / some ISP DNS resolvers don't reliably support SRV
// record lookups, which mongodb+srv:// needs. Force public resolvers
// that do. Must be imported before anything that calls mongoose.connect().
dns.setServers(['8.8.8.8', '1.1.1.1']);