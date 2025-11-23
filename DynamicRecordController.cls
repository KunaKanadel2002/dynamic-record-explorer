public with sharing class DynamicRecordController {

    @AuraEnabled(cacheable=true)
    public static List<String> getObjectList() {
        List<String> names = new List<String>();
        for (Schema.SObjectType t : Schema.getGlobalDescribe().values()) {
            Schema.DescribeSObjectResult d = t.getDescribe();
            if (d.isQueryable() && d.isAccessible()) {
                names.add(d.getName());
            }
        }
        names.sort();
        return names;
    }

    @AuraEnabled(cacheable=true)
    public static List<String> getFieldList(String objectName) {
        Schema.DescribeSObjectResult d = Schema.getGlobalDescribe()
            .get(objectName).getDescribe();
        List<String> fields = new List<String>();

        for (Schema.SObjectField f : d.fields.getMap().values()) {
            if (f.getDescribe().isAccessible()) {
                fields.add(f.getDescribe().getName());
            }
        }
        fields.sort();
        return fields;
    }

    @AuraEnabled
    public static List<SObject> fetchDynamic(String objectName) {

        // Build dynamic field list instead of SELECT *
        Schema.DescribeSObjectResult d = Schema.getGlobalDescribe()
            .get(objectName).getDescribe();

        List<String> fieldNames = new List<String>();

        for (Schema.SObjectField f : d.fields.getMap().values()) {
            if (f.getDescribe().isAccessible()) {
                fieldNames.add(f.getDescribe().getName());
            }
        }

        String query =
            'SELECT ' + String.join(fieldNames, ',') +
            ' FROM ' + objectName +
            ' LIMIT 100';

        return Database.query(query);
    }
}